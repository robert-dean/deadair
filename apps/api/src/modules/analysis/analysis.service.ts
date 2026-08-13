import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { ANALYSIS_SCHEMA_VERSION, type AnalysisRef } from '@deadair/plugin-sdk';
import { asAnalysisPlugin, type AnalysisPlugin } from '#modules/plugins/plugin.capabilities.js';
import { pluginsWith } from '#modules/plugins/plugin.selection.js';
import { PluginInvoker } from '#modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '#modules/plugins/plugin.registry.js';
import { TrackAudioResolver } from '#modules/playout/providers/track.audio.resolver.js';
import { AnalysisRepository, type AnalysableTrack } from './analysis.repository.js';
import {
    ANALYSIS_CONCURRENCY_KEY,
    ANALYSIS_PLUGIN_KEY,
    DEFAULT_ANALYSIS_CONCURRENCY,
    explainNoAnalyzer,
    resolveAnalysisConcurrency,
    selectAnalysisPlugin,
} from './analysis.settings.js';
import { errorText } from '#modules/shared/error.text.js';

/**
 * How long one measurement may take, as the host's invocation deadline.
 *
 * Minutes, and this is the number that has to be generous rather than the
 * plugin's own: the invoker caps the plugin's `host.fetch` budget at whatever
 * the invocation has left, so a stingy figure here silently overrides the
 * plugin's more generous one. Left at the host's fifteen-second default, every
 * track fails at exactly the same moment and it looks like a broken analyzer.
 *
 * Deliberately above the adapter's own `ANALYZE_TIMEOUT_MS`, so the plugin's
 * timeout is the one that fires and the error says what actually happened.
 */
export const ANALYZE_INVOKE_TIMEOUT_MS = 6 * 60_000;

/**
 * How long to wait between tracks, so a run is a trickle rather than a burst.
 *
 * `BATCH_SIZE` in `analysis.job.ts` bounds one run; this bounds the RATE inside
 * it, and the two are different protections. A provider's limiter counts requests
 * per interval, so five fetches in five seconds can trip what five in five
 * minutes does not — and the download itself is the expensive part, not the gap
 * after it.
 *
 * Charged after each track rather than before, so an empty queue costs nothing.
 *
 * It lives HERE rather than beside the batch size it partners, which reads
 * backwards and is deliberate: the job imports the service, so a constant the
 * service reads cannot live in the job. That cycle loads fine under vitest and
 * throws `Cannot access 'AnalysisService' before initialization` under Node's ESM
 * loader, which is a failure no unit test in this repo would have caught.
 */
export const TRACK_PACE_MS = 60_000;

/** What one pass did, for the job's log line. */
export interface AnalysisPassSummary {
    scanned: number;
    measured: number;
    failed: number;
    /** Measured, but of a file the analyzer said it did not fully receive. */
    incomplete: number;
}

/**
 * Measuring the catalog, one track at a time.
 *
 * The walk itself is the job's; this is what happens to one track, plus the
 * decision about who does the measuring. Kept apart from the job for the reason
 * `EnrichmentService` is: the pass has to be callable without a scheduler, and
 * the plugin selection has three failure modes that are worth naming on their
 * own rather than inside a run.
 */
@Injectable()
export class AnalysisService {
    constructor(
        private readonly repository: AnalysisRepository,
        private readonly registry: PluginRegistry,
        private readonly invoker: PluginInvoker,
        // The station's own audio route, which fetches from the provider itself when the station has
        // not got the record yet. The analyzer is a container of its own, so it wants a URL rather
        // than bytes in hand — and this URL works from anywhere that can reach the app.
        private readonly trackAudio: TrackAudioResolver,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    /**
     * Every plugin that could measure, right now.
     *
     * A list rather than the choice, because the caller that has to explain
     * itself needs to know how many there were: "none installed" and "several
     * and you have not picked" are different sentences and different fixes.
     */
    candidates(): AnalysisPlugin[] {
        return pluginsWith(this.registry.list(), asAnalysisPlugin);
    }

    /**
     * The analyzer to use, or `undefined` with the reason logged.
     *
     * **A station with no analyzer is an ordinary state, not a fault**, the way
     * one with no model is: every track still plays, unmeasured, and every
     * consumer of a measurement degrades to a defined behaviour. So this reports
     * rather than throws, and the job does nothing quietly.
     */
    analyzer(): AnalysisPlugin | undefined {
        const candidates = this.candidates();
        const configured = this.config.get(ANALYSIS_PLUGIN_KEY, '');
        const chosen = selectAnalysisPlugin(candidates, configured);

        if (chosen === undefined) {
            this.logger.info('analysis: nothing to measure with', { reason: explainNoAnalyzer(candidates, configured) });
        }
        return chosen;
    }

    /** How many measurements to keep in flight. See {@link resolveAnalysisConcurrency}. */
    concurrency(): number {
        return resolveAnalysisConcurrency(this.config.get(ANALYSIS_CONCURRENCY_KEY, DEFAULT_ANALYSIS_CONCURRENCY));
    }

    /**
     * Measure as much of the outstanding queue as the budget allows.
     *
     * The signal stops the walk between tracks rather than mid-measurement: a
     * decode already in flight is paid for either way, and abandoning it would
     * leave the analyzer working on something nothing will store. A track
     * nothing reached is simply still outstanding, and there is always another
     * pass.
     */
    async analysePending(limit: number, signal?: AbortSignal, paceMs = TRACK_PACE_MS): Promise<AnalysisPassSummary> {
        const summary: AnalysisPassSummary = { scanned: 0, measured: 0, failed: 0, incomplete: 0 };

        const analyzer = this.analyzer();
        if (analyzer === undefined) return summary;

        const tracks = await this.repository.listTracksNeedingAnalysis(ANALYSIS_SCHEMA_VERSION, limit);
        if (tracks.length === 0) return summary;

        const queue = [...tracks];
        const width = Math.min(this.concurrency(), queue.length);

        // Workers pulling from one queue rather than fixed-size chunks: tracks
        // take wildly different times to decode, and a chunked pass would sit
        // idle waiting for the slowest member of each batch.
        await Promise.all(
            Array.from({ length: width }, async () => {
                while (!signal?.aborted) {
                    const track = queue.shift();
                    if (track === undefined) return;

                    summary.scanned += 1;
                    await this.measureOne(analyzer, track, summary);

                    // Paced, because measuring a track is a FULL AUDIO DOWNLOAD
                    // through the same credential the station plays on, and a
                    // burst of them exhausted a provider's audio-key quota once
                    // and took the station off air. Charged only when there is
                    // more to do, so a short queue is not padded for nothing.
                    if (queue.length > 0) await this.pause(paceMs, signal);
                }
            }),
        );

        return summary;
    }

    /**
     * Wait, unless the run is being stopped.
     *
     * Resolves on abort rather than rejecting: the caller's next move is to check
     * the signal and return, and a rejection here would turn an ordinary
     * end-of-run into an error path.
     */
    private pause(ms: number, signal?: AbortSignal): Promise<void> {
        if (ms <= 0 || signal?.aborted) return Promise.resolve();

        return new Promise<void>(resolve => {
            const done = (): void => {
                clearTimeout(timer);
                signal?.removeEventListener('abort', done);
                resolve();
            };
            const timer = setTimeout(done, ms);
            signal?.addEventListener('abort', done, { once: true });
        });
    }

    /**
     * One track: resolve its audio, measure it, write the outcome.
     *
     * Never throws. Everything that can go wrong here is one track's problem,
     * and the pass around it has already paid for the others.
     */
    private async measureOne(analyzer: AnalysisPlugin, track: AnalysableTrack, summary: AnalysisPassSummary): Promise<void> {
        const pluginId = analyzer.record.id;

        // Resolved here rather than by the analyzer, because a plugin cannot ask another plugin for
        // anything: the copy that can actually be served is a binding the catalog owns, and reaching
        // it is the host's job.
        //
        // One resolver, and it is the station's own route rather than the provider's URL. Two things
        // fall out of that, and both are the point:
        //
        //  - The bytes measured are the bytes that AIR. Cue points and loudness describe a specific
        //    encode, and `/playout/audio/{sourceId}` is what the player will fetch too, so a provider
        //    that re-encodes between the measurement and the play can no longer put `liq_cue_in` out.
        //  - A record the station has never played is measured all the same: the route fetches it on
        //    demand, so there is nothing here to fall back to and no cache-then-provider two-step. It
        //    also means the measurement pays for a download the station keeps, when it is keeping.
        const audioUrl = await this.trackAudio.resolveBinding(track.pluginId, track.externalId);
        if (audioUrl === undefined) {
            // Not recorded as a failure. Nothing about the TRACK is wrong -- its
            // provider is disabled, unconfigured or between reloads -- and
            // writing a failure would take it out of the queue for a day over
            // something that may be fixed in a minute.
            this.logger.debug('analysis: no audio url for a track', { track: track.trackId, provider: track.pluginId });
            return;
        }

        const ref: AnalysisRef = {
            trackId: track.trackId,
            audioUrl,
            ...(track.durationMs === undefined ? {} : { durationMs: track.durationMs }),
        };

        try {
            const result = await this.invoker.invoke(pluginId, 'analysis.analyzeTrack', async () => analyzer.instance.analyzeTrack(ref), {
                timeoutMs: ANALYZE_INVOKE_TIMEOUT_MS,
            });

            await this.repository.recordAnalysis(track.trackId, pluginId, result);

            summary.measured += 1;
            if (!result.complete) {
                summary.incomplete += 1;
                // Worth a line each time rather than a counter alone: an
                // incomplete measurement is stored and then ignored by every
                // reader, so a station where this is common is doing the work
                // and getting nothing, with nothing else to say so.
                this.logger.warn('analysis: measured only part of a file', {
                    track: track.trackId,
                    title: track.title,
                    artist: track.artistName,
                });
            }
        } catch (error) {
            summary.failed += 1;
            const reason = errorText(error);

            this.logger.warn('analysis: could not measure a track', {
                track: track.trackId,
                title: track.title,
                artist: track.artistName,
                error: reason,
            });

            // Recorded so the next pass does not pay for the same decode again.
            // A write that itself fails is left alone: the track stays
            // outstanding, which is the same state it was in a moment ago.
            await this.repository.recordFailure(track.trackId, pluginId, reason).catch((writeError: unknown) => {
                this.logger.error('analysis: could not record a failure', {
                    track: track.trackId,
                    error: errorText(writeError),
                });
            });
        }
    }
}
