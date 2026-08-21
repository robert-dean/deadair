import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { ANALYSIS_SCHEMA_VERSION, type AnalysisRef, type TrackAnalysis } from '@deadair/plugin-sdk';
import { asAnalysisPlugin, type AnalysisPlugin } from '#modules/plugins/plugin.capabilities.js';
import { byPluginId, defaultPickIsNews, pluginsWith } from '#modules/plugins/plugin.selection.js';
import { PluginInvoker } from '#modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '#modules/plugins/plugin.registry.js';
import { TrackAudioResolver } from '#modules/playout/providers/track.audio.resolver.js';
import { TrackAudioService } from '#modules/playout/audio/track.audio.service.js';
import { AnalysisRepository, type AnalysableTrack } from './analysis.repository.js';
import {
    ANALYSIS_CONCURRENCY_KEY,
    ANALYSIS_LOCAL_PACE_KEY,
    ANALYSIS_PLUGIN_KEY,
    ANALYSIS_PROVIDER_PACE_KEY,
    DEFAULT_ANALYSIS_CONCURRENCY,
    DEFAULT_ANALYSIS_LOCAL_PACE_MS,
    DEFAULT_ANALYSIS_PROVIDER_PACE_MS,
    explainDefaultAnalyzer,
    explainNoAnalyzer,
    resolveAnalysisConcurrency,
    resolveAnalysisPaceMs,
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
 * An override for one call, bypassing the settings this otherwise reads.
 *
 * The only caller that wants this is a test: the job never passes one, so a run always waits on
 * whatever `analysis.providerPaceMs` and `analysis.localPaceMs` currently say.
 */
export interface AnalysisPaceOverride {
    providerPaceMs?: number;
    localPaceMs?: number;
}

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
        // Asked once per track, BEFORE resolving that same track's URL, so the pace after it can tell
        // a copy the station already keeps from one the analyzer is about to make it fetch. See
        // `measureOne`.
        private readonly audioService: TrackAudioService,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    /**
     * Every plugin that could measure, right now.
     *
     * A list rather than the choice, because the caller that has to explain
     * itself needs to know how many there were: "none installed" and "several
     * and you have not picked" are different sentences and different fixes.
     *
     * Sorted, like `SpeechService.speakers` and `LlmService.generators`, and it
     * is load-bearing rather than tidy now: an unset key takes the FIRST
     * candidate, and installation order is whatever the disk scan found, so
     * without this a station with two analyzers could measure with a different
     * one after a restart and nothing would say so.
     */
    candidates(): AnalysisPlugin[] {
        return pluginsWith(this.registry.list(), asAnalysisPlugin).sort(byPluginId);
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
            return undefined;
        }

        // On the edge only, for `SpeechService.speaker`'s reason. It matters more here than there,
        // because nothing about a station measured by an analyzer nobody chose looks wrong from the
        // outside: this line is the only place it is ever said.
        if (defaultPickIsNews(chosen, candidates, ANALYSIS_PLUGIN_KEY)) {
            this.logger.info(`analysis: ${explainDefaultAnalyzer(chosen, candidates)}`);
        }
        return chosen;
    }

    /**
     * Measure one file the caller already has a URL for.
     *
     * The narrow half of {@link measureOne}: no queue, no pace, no repository, no
     * failure row. It exists for audio the station MADE rather than found — a
     * rendered segment, measured once, immediately, by the caller that produced
     * it — where every one of those things is machinery for a walk that does not
     * apply. There is no second copy to prefer, no upstream to be polite to, and
     * nothing to re-measure on a later pass, so a failure here is worth a log
     * line and nothing else.
     *
     * `undefined` for every failure, including having no analyzer at all, and the
     * caller is expected to carry on: a station with no analyzer measures nothing
     * and still airs everything, which is the rule the whole measurement path is
     * held to.
     *
     * @param id - What this audio is, for the plugin's own logging. Not read back.
     * @param audioUrl - Reachable from wherever the decoding happens, which is a sidecar container
     *                   rather than this process. See {@link AnalysisRef.audioUrl}.
     */
    async measureAudio(id: string, audioUrl: string, durationMs?: number): Promise<TrackAnalysis | undefined> {
        const analyzer = this.analyzer();
        if (analyzer === undefined) return undefined;

        const ref: AnalysisRef = { trackId: id, audioUrl, ...(durationMs === undefined ? {} : { durationMs }) };

        try {
            return await this.invoker.invoke(analyzer.record.id, 'analysis.analyzeTrack', async () => analyzer.instance.analyzeTrack(ref), {
                timeoutMs: ANALYZE_INVOKE_TIMEOUT_MS,
            });
        } catch (error) {
            this.logger.warn('analysis: could not measure a file', { id, error: errorText(error) });
            return undefined;
        }
    }

    /** How many measurements to keep in flight. See {@link resolveAnalysisConcurrency}. */
    concurrency(): number {
        return resolveAnalysisConcurrency(this.config.get(ANALYSIS_CONCURRENCY_KEY, DEFAULT_ANALYSIS_CONCURRENCY));
    }

    /** How long to wait after a track the walk had to fetch from a provider. See {@link resolveAnalysisPaceMs}. */
    providerPaceMs(): number {
        return resolveAnalysisPaceMs(
            this.config.get(ANALYSIS_PROVIDER_PACE_KEY, DEFAULT_ANALYSIS_PROVIDER_PACE_MS),
            DEFAULT_ANALYSIS_PROVIDER_PACE_MS,
        );
    }

    /** How long to wait after a track whose audio was already on this machine. See {@link resolveAnalysisPaceMs}. */
    localPaceMs(): number {
        return resolveAnalysisPaceMs(this.config.get(ANALYSIS_LOCAL_PACE_KEY, DEFAULT_ANALYSIS_LOCAL_PACE_MS), DEFAULT_ANALYSIS_LOCAL_PACE_MS);
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
    async analysePending(
        limit: number,
        signal?: AbortSignal,
        pace: AnalysisPaceOverride = {},
        providerLimit: number = Number.POSITIVE_INFINITY,
    ): Promise<AnalysisPassSummary> {
        const summary: AnalysisPassSummary = { scanned: 0, measured: 0, failed: 0, incomplete: 0 };

        const analyzer = this.analyzer();
        if (analyzer === undefined) return summary;

        const tracks = await this.repository.listTracksNeedingAnalysis(ANALYSIS_SCHEMA_VERSION, limit);
        if (tracks.length === 0) return summary;

        const providerPaceMs = pace.providerPaceMs ?? this.providerPaceMs();
        const localPaceMs = pace.localPaceMs ?? this.localPaceMs();

        const queue = [...tracks];
        const width = Math.min(this.concurrency(), queue.length);

        // Spent only by a track this machine does NOT already hold. The scan limit above bounds how
        // much work a run looks at; this bounds the only part of it that costs the station
        // something, which is the provider credential playout is also using. See `AnalysisJob`.
        let providerSpent = 0;

        // Workers pulling from one queue rather than fixed-size chunks: tracks
        // take wildly different times to decode, and a chunked pass would sit
        // idle waiting for the slowest member of each batch.
        await Promise.all(
            Array.from({ length: width }, async () => {
                while (!signal?.aborted) {
                    const track = queue.shift();
                    if (track === undefined) return;

                    summary.scanned += 1;
                    const wasLocal = await this.measureOne(analyzer, track, summary);
                    if (!wasLocal) providerSpent += 1;

                    // Stop the walk rather than skip the track: `listTracksNeedingAnalysis` hands
                    // over the local ones FIRST, so everything left behind a spent budget needs a
                    // download too. Checked after the measurement, so the ceiling is a count of what
                    // was spent rather than of what was attempted, and overshoots by at most one per
                    // worker.
                    if (providerSpent >= providerLimit) return;

                    // Paced, because measuring a track that is NOT already on this machine is a FULL
                    // AUDIO DOWNLOAD through the same credential the station plays on, and a burst of
                    // them exhausted a provider's audio-key quota once and took the station off air.
                    // A track that was already local pays the gentler rate instead — still a pace
                    // rather than nothing, because background analysis running flat out is still real
                    // disk and decode work on a machine nobody asked to donate it. Charged only when
                    // there is more to do, so a short queue is not padded for nothing.
                    if (queue.length > 0) await this.pause(wasLocal ? localPaceMs : providerPaceMs, signal);
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
     *
     * @returns Whether this measurement needed no provider fetch, which is what the pause after it is
     * chosen by. Answered `true` for a copy already on this machine AND for a track that never reached
     * the analyzer at all — neither one made a request to a rate-limited upstream, so neither one owes
     * that pace. Answered before the analyzer's own fetch runs, from what {@link TrackAudioService}
     * already knows, because the analyzer's request happens inside a plugin call this service cannot
     * see the inside of.
     */
    private async measureOne(analyzer: AnalysisPlugin, track: AnalysableTrack, summary: AnalysisPassSummary): Promise<boolean> {
        const pluginId = analyzer.record.id;

        // Checked BEFORE resolving the same track's URL and BEFORE the analyzer ever asks for it. A
        // failure here is read as "not local" rather than propagated: that is the pace-conservative
        // answer, so a check this can never usefully retry does not cost the track its measurement.
        const wasLocal = await this.audioService.has({ pluginId: track.pluginId, externalId: track.externalId }).catch(() => false);

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
            // Nothing was fetched, so this is the cheap case regardless of `wasLocal`.
            return true;
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

        return wasLocal;
    }
}
