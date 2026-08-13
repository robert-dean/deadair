import { Container, Injectable } from 'injectkit';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { PlainJob } from '#modules/jobs/plain.job.js';
import { ArtCacheService } from './art.cache.service.js';
import { ArtRepository } from './art.repository.js';

/**
 * URLs examined per run.
 *
 * Larger than the enrichment walk's batch because there is no published rate limit to respect here:
 * an image is one request to a CDN, not a query against a courtesy-limited metadata service. Sized
 * so a run finishes well inside the cron interval even when every fetch times out.
 */
const BATCH_SIZE = 50;

/**
 * Images in flight at once.
 *
 * Small on purpose. The whole batch usually belongs to one or two upstreams, and the point of
 * caching art is to stop leaning on somebody else's CDN, which twenty parallel connections would be
 * a poor way to start.
 */
const CONCURRENCY = 4;

export interface ArtCachePayload {
    /** Overrides {@link BATCH_SIZE} for one run. Absent, as it always is from cron, means the default. */
    limit?: number;
}

/**
 * The scheduled art fetch: every upstream art URL the catalog holds, pulled into the local store.
 *
 * A plain `Job` rather than a `TransactionalJob`, for the same reason `CatalogSyncJob` and
 * `EnrichmentJob` are: a walk with network in the middle of it would pin a runtime-pool connection
 * and hold one snapshot open for its whole length. Each URL settles on its own, and every write on
 * this path is idempotent, so overlapping runs cost duplicated work rather than a wrong row.
 */
@Injectable()
export class ArtCacheJob extends PlainJob<ArtCachePayload> {
    constructor(
        private readonly artCache: ArtCacheService,
        private readonly artRepository: ArtRepository,
        context: JobContext,
        container: Container,
        logger: Logger,
    ) {
        super(context, container, logger);
    }

    protected async execute(payload?: ArtCachePayload, signal?: AbortSignal): Promise<void> {
        const pending = await this.artRepository.listPendingSourceUrls(payload?.limit ?? BATCH_SIZE);
        if (pending.length === 0) return;

        let cached = 0;
        let failed = 0;

        // A shared cursor rather than fixed slices: one slow upstream would otherwise leave its
        // worker grinding while the others sat idle with the batch already divided up.
        let next = 0;
        const worker = async (): Promise<void> => {
            while (next < pending.length && !signal?.aborted) {
                const outcome = await this.artCache.cache(pending[next++]!, signal);
                if (outcome.cached) cached++;
                else failed++;
            }
        };

        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker));

        this.logger.info('art cache pass', { job: this.context.id, scanned: pending.length, cached, failed });
    }
}
