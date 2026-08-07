import { Container, Injectable, ScopedContainer } from 'injectkit';
import { Job, JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { overrideJobActor } from '#modules/jobs/job.authorization.js';
import { EnrichmentService } from './enrichment.service.js';

/**
 * Rows examined per run, per kind — a ceiling, not a target.
 *
 * How long a run takes is governed by {@link RUN_BUDGET_MS}, not by this. That
 * split matters: a count only predicts a duration if you know what a request
 * costs, and the honest answer is that nobody does. MusicBrainz asks for one
 * request a second and usually answers well inside that, but under load it
 * answers in ten, or it sheds with a 503 and the host spends the budget backing
 * off and retrying. Sizing the batch as `requests × one second` quietly assumed
 * the good case and overran the cron interval in the bad one, which is how two
 * runs end up on the same limiter starving each other into timeouts — and three
 * consecutive timeouts quarantine the plugin outright.
 *
 * So the number is generous and the clock is what stops the walk. Whatever is
 * left is picked up by the next run, and there is always a next run.
 */
const BATCH_SIZE = 75;

/**
 * How long a run may keep asking for more work before it stops.
 *
 * Comfortably inside the cron interval and inside the job's `expiresIn`, so a
 * slow upstream cannot make one run collide with the next however slow it gets.
 * The passes check the signal between entities, so this stops the walk at the
 * next clean boundary rather than abandoning a track mid-flight: a row nothing
 * reached is simply still outstanding.
 */
export const RUN_BUDGET_MS = 11 * 60 * 1000;

export interface EnrichmentPayload {
    /** Overrides {@link BATCH_SIZE} for one run. Absent, as it always is from cron, means the default. */
    limit?: number;
}

/**
 * The scheduled enrichment walk: tracks, then the artists and records behind
 * them.
 *
 * A plain `Job` rather than a `TransactionalJob`, for the same reason
 * `CatalogSyncJob` is: this is a long walk with rate-limited network in the
 * middle of it, and wrapping it would pin a runtime-pool connection and hold
 * one snapshot open for the length of the walk. Each track settles on its own.
 *
 * Because it is not transactional, the actor has to be installed here; nothing
 * else in a plain job's scope does it.
 */
@Injectable()
export class EnrichmentJob implements Job<EnrichmentPayload> {
    constructor(
        private readonly enrichment: EnrichmentService,
        private readonly context: JobContext,
        // `Container` resolves to the container doing the resolving, which for a
        // job is the runner's per-execution scope. `ScopedContainer` is a type
        // alias, not a token, so it can only be the cast — same as CatalogSyncJob.
        private readonly container: Container,
        private readonly logger: Logger,
    ) {}

    async run(payload?: EnrichmentPayload, signal?: AbortSignal): Promise<void> {
        overrideJobActor(this.container as ScopedContainer, this.context);
        const limit = payload?.limit ?? BATCH_SIZE;

        // A plain controller on a plain timer rather than `AbortSignal.timeout`,
        // for the reason `plugin.invocation.deadline.ts` gives: that one's timer
        // is unref'd and invisible to fake timers, which would make the budget
        // untestable.
        const budget = new AbortController();
        const timer = setTimeout(() => budget.abort(), RUN_BUDGET_MS);
        const stop = signal ? AbortSignal.any([signal, budget.signal]) : budget.signal;

        try {
            // Tracks first, and all three in the same run rather than three jobs.
            // The artist pass wants `artists.mbid`, which the track pass promotes
            // for free off the recording's artist credit, and separate jobs would
            // put three walks on the same one-request-per-second limiter.
            const tracks = await this.enrichment.enrichPending(limit, stop);
            const artists = await this.enrichment.enrichPendingArtists(limit, stop);
            const albums = await this.enrichment.enrichPendingAlbums(limit, stop);

            // Quiet when there was nothing to do: with a cron this frequent, an
            // idle station would otherwise write a line every few minutes saying so.
            if (tracks.scanned + artists.scanned + albums.scanned > 0) {
                // `outOfTime` is the signal that the upstream is slow enough to
                // be the thing setting the pace. It is not an error — the walk
                // stopped where it was told to — but a run that reports it every
                // time is one whose sources are struggling.
                this.logger.info('enrichment pass', { job: this.context.id, tracks, artists, albums, outOfTime: budget.signal.aborted });
            }
        } finally {
            clearTimeout(timer);
        }
    }
}
