import { Container, Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { AnalysisService } from '#modules/analysis/analysis.service.js';
import { PlainJob } from '#modules/jobs/plain.job.js';
import { resolvePlayoutBaseUrl, segmentAudioUrl } from '#modules/playout/playout.urls.js';
import { SegmentRepository } from './segment.repository.js';
import { SpeechService } from './speech.service.js';
import { errorText } from '#modules/shared/error.text.js';

export interface RenderSegmentPayload {
    /**
     * Which segment to speak.
     *
     * Optional in the type and required in practice, the way `ExtendLineupPayload.lineupId` is: a
     * job registration is typed against a payload the broker may deliver as `{}`, so this cannot be
     * declared required without the mapping refusing it. The run guards on it instead.
     */
    segmentId?: string;
}

/**
 * Say a written segment out loud, and keep the audio.
 *
 * `written → rendering → ready`, or `failed` with the reason. This is the piece
 * `docs/todo/dj-voice.md` calls the whole of the missing infrastructure, and the second half of
 * making a break: deciding what it says is `WriteBreakJob`'s, one stage earlier.
 *
 * It starts at `written` rather than at `planned` deliberately. A break whose words have not been
 * decided is not this job's to render, and a retry after a failed synthesis re-speaks the words
 * already on the row rather than sending the break back to be rewritten — which on a model would be
 * a bill as well as a change nobody asked for.
 *
 * A plain `Job` and not a `TransactionalJob`, following `ExtendLineupJob` and `EnrichmentJob`:
 * wrapping it would pin a runtime-pool connection for the length of a synthesis, which is seconds
 * of somebody else's compute, and the writes at either end are one row each.
 *
 * ## Why nothing waits on this
 *
 * The director SKIPS a segment that is not `ready` rather than holding a slot open for it. So a
 * render that is slow, or broken, or never runs at all, costs the station a break and never
 * silence — which is what makes it safe for this to be a background job with no deadline anyone
 * downstream cares about, and why the failure path here is a logged row rather than an alert.
 *
 * Safe to retry, and guarded against being retried while still running: `claimForRender` is a
 * conditional update, so a second attempt arriving mid-synthesis finds the row already `rendering`
 * and stops rather than paying twice for the same audio.
 */
@Injectable()
export class RenderSegmentJob extends PlainJob<RenderSegmentPayload> {
    constructor(
        private readonly segments: SegmentRepository,
        private readonly speech: SpeechService,
        // The analyzer, for how loud the result came out. A module later in the list than this one,
        // which is a lifecycle order rather than a wiring one: everything registers before anything
        // resolves, and this is resolved when a job runs.
        private readonly analysis: AnalysisService,
        private readonly config: AppConfig,
        context: JobContext,
        container: Container,
        logger: Logger,
    ) {
        super(context, container, logger);
    }

    protected async execute(payload?: RenderSegmentPayload, signal?: AbortSignal): Promise<void> {
        if (!payload?.segmentId) {
            // A caller's bug rather than a station fault: this job is only ever sent, never
            // scheduled, so there is no payload-less run that means anything.
            this.logger.warn('render: a segment render was sent with nothing to render', { job: this.context.id });
            return;
        }

        const segment = await this.segments.claimForRender(payload.segmentId);
        if (segment === undefined) {
            // Deleted, already rendering, or already ready. All three are ordinary races rather
            // than failures, and all three mean the same thing here: not ours to do.
            this.logger.info('render: nothing to render for this segment', { job: this.context.id, segment: payload.segmentId });
            return;
        }

        const script = segment.script?.trim();
        if (!script) {
            // Left `failed` rather than dropped back to `planned`, so it is visible in the console
            // instead of being retried forever by anything that walks planned segments.
            await this.segments.markFailed(segment.id, 'this segment has no script to say', 'rendering');
            this.logger.warn('render: a segment was planned with no script', { job: this.context.id, segment: segment.id });
            return;
        }

        if (signal?.aborted) {
            // Put it back rather than leaving it stuck in `rendering`, where nothing would ever
            // claim it again.
            await this.segments.markFailed(segment.id, 'the render was abandoned before it started', 'rendering');
            return;
        }

        try {
            const audio = await this.speech.speak({ text: script, ...(segment.voice === undefined ? {} : { voice: segment.voice }) });
            await this.segments.markReady(segment.id, { audioChecksum: audio.checksum, audioExt: audio.ext });

            this.logger.info('render: a segment is ready to air', {
                job: this.context.id,
                segment: segment.id,
                label: segment.label,
                plugin: audio.pluginId,
                ext: audio.ext,
            });

            // AFTER the row is ready, and deliberately not part of the same statement. The break can
            // air from this moment; how loud it is can catch up. See `measure`.
            await this.measure(segment.id);
        } catch (error) {
            const message = errorText(error);

            // The reason goes on the row, because the console is where an operator looks and a log
            // line scrolls away. Not rethrown: a failed render is data, and letting it bubble would
            // spend the job's one retry on a plugin that is usually still down.
            await this.segments.markFailed(segment.id, message, 'rendering');
            this.logger.warn('render: could not speak a segment', { job: this.context.id, segment: segment.id, error: message });
        }
    }

    /**
     * Find out how loud the break came out, and write it down.
     *
     * A speech engine aims at no particular level, so this is the only thing that can tell the
     * station where its own voice actually landed — and the level is not the engine's constant
     * either: it moves with the voice, and to a lesser extent with the line. `speechGainFor` turns
     * this into the gain both routes to the mount are stamped with.
     *
     * **Nothing here may cost the break.** Every failure is a log line: the analyzer is optional
     * (a station with none measures nothing and airs everything), the sidecar is another container,
     * and the fallback underneath is an assumed speech level that is wrong by a decibel or so
     * rather than wrong by ten. So this is awaited but never thrown from, and the segment is
     * already `ready` before it is called.
     *
     * The URL is the station's OWN route, for the same reason the catalog's measurements use it:
     * the bytes measured are the bytes that air, and it is reachable from a sidecar container where
     * a path on this machine's disk is not.
     */
    private async measure(segmentId: string): Promise<void> {
        try {
            const url = segmentAudioUrl(resolvePlayoutBaseUrl(this.config), segmentId);
            const result = await this.analysis.measureAudio(segmentId, url);
            const loudnessLufs = result?.data.loudnessLufs;

            // A measurement without a loudness figure is allowed by the contract — the cue points
            // are required and this is not — and near-silence legitimately has none.
            if (typeof loudnessLufs !== 'number' || !Number.isFinite(loudnessLufs)) return;

            await this.segments.recordLoudness(segmentId, loudnessLufs);
            this.logger.debug('render: measured a segment', { job: this.context.id, segment: segmentId, loudnessLufs });
        } catch (error) {
            this.logger.warn('render: could not measure a segment; it will air at the assumed speech level', {
                job: this.context.id,
                segment: segmentId,
                error: errorText(error),
            });
        }
    }
}
