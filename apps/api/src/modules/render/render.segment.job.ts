import { Container, Injectable, ScopedContainer } from 'injectkit';
import { Job, JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { overrideJobActor } from '#modules/jobs/job.authorization.js';
import { SegmentRepository } from './segment.repository.js';
import { SpeechService } from './speech.service.js';

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
 * Say a planned segment out loud, and keep the audio.
 *
 * `planned → rendering → ready`, or `failed` with the reason. This is the piece
 * `docs/todo/dj-voice.md` calls the whole of the missing infrastructure, and the only thing that
 * ever writes the three states the schema has carried unused since segments landed.
 *
 * A plain `Job` and not a `TransactionalJob`, following `ExtendLineupJob` and `EnrichmentJob`:
 * wrapping it would pin a runtime-pool connection for the length of a synthesis, which is seconds
 * of somebody else's compute, and the writes at either end are one row each. Because it is not
 * transactional, the actor has to be installed here.
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
export class RenderSegmentJob implements Job<RenderSegmentPayload> {
    constructor(
        private readonly segments: SegmentRepository,
        private readonly speech: SpeechService,
        private readonly context: JobContext,
        // `Container` resolves to the container doing the resolving, which for a job is the
        // runner's per-execution scope. `ScopedContainer` is a type alias, not a token, so it can
        // only be the cast — same as ExtendLineupJob.
        private readonly container: Container,
        private readonly logger: Logger,
    ) {}

    async run(payload?: RenderSegmentPayload, signal?: AbortSignal): Promise<void> {
        overrideJobActor(this.container as ScopedContainer, this.context);

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
            await this.segments.markFailed(segment.id, 'this segment has no script to say');
            this.logger.warn('render: a segment was planned with no script', { job: this.context.id, segment: segment.id });
            return;
        }

        if (signal?.aborted) {
            // Put it back rather than leaving it stuck in `rendering`, where nothing would ever
            // claim it again.
            await this.segments.markFailed(segment.id, 'the render was abandoned before it started');
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
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);

            // The reason goes on the row, because the console is where an operator looks and a log
            // line scrolls away. Not rethrown: a failed render is data, and letting it bubble would
            // spend the job's one retry on a plugin that is usually still down.
            await this.segments.markFailed(segment.id, message);
            this.logger.warn('render: could not speak a segment', { job: this.context.id, segment: segment.id, error: message });
        }
    }
}
