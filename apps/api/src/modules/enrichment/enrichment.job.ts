import { Container, Injectable, ScopedContainer } from 'injectkit';
import { Job, JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { overrideJobActor } from '#modules/jobs/job.authorization.js';
import { EnrichmentService } from './enrichment.service.js';

/**
 * Tracks examined per run.
 *
 * Small, because the clock here belongs to the upstream: MusicBrainz asks
 * anonymous clients for one request per second and a track costs a few, so this
 * is really a statement that a run takes a couple of minutes rather than a
 * quarter of an hour. Sized to finish comfortably inside the cron interval, so
 * two runs do not normally overlap — and if they ever do, every write on this
 * path is idempotent, so the cost is duplicated work rather than a wrong row.
 */
const BATCH_SIZE = 25;

export interface EnrichmentPayload {
    /** Overrides {@link BATCH_SIZE} for one run. Absent, as it always is from cron, means the default. */
    limit?: number;
}

/**
 * The scheduled enrichment walk: the thing that finally calls `enrichTrack`.
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

        const summary = await this.enrichment.enrichPending(payload?.limit ?? BATCH_SIZE, signal);
        // Quiet when there was nothing to do: with a cron this frequent, an
        // idle station would otherwise write a line every few minutes saying so.
        if (summary.scanned > 0) this.logger.info('enrichment pass', { job: this.context.id, ...summary });
    }
}
