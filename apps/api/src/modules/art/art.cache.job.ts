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
    /**
     * Fetch exactly these, ahead of everything the backlog holds.
     *
     * The director asks for the covers of records it is about to air, because the cron sweep walks
     * the catalog in URL order and has no idea what is on tonight: a record picked while the
     * backlog is deep would otherwise reach the mount before its cover did, and the mount carries
     * the station's logo instead of a sleeve. Absent, as it always is from cron, means the
     * backlog.
     *
     * Capped at {@link BATCH_SIZE} like any other run, and deduplicated, so a caller that asks for
     * a whole running order costs the same as a sweep.
     */
    urls?: string[];
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
        // A named set of URLs replaces the backlog query rather than adding to it: the caller is
        // asking for these because they are wanted NOW, and a run that also walked the backlog
        // would spend its concurrency on whatever happens to sort first.
        //
        // Anything already here is dropped before fetching, because `cache` does NOT check: it
        // downloads and writes unconditionally, which is right for the sweep (whose query only
        // ever yields URLs with no bytes) and wrong for a caller that asks by name. Two commit
        // passes a second apart will both see a cover as missing while the first fetch is still in
        // flight, and without this that is two downloads of one image.
        const asked = [...new Set(payload?.urls ?? [])].slice(0, payload?.limit ?? BATCH_SIZE);
        const held = asked.length === 0 ? new Map() : await this.artRepository.findBySourceUrls(asked);
        const wanted = asked.filter(url => held.get(url)?.checksum === undefined);

        const pending = asked.length > 0 ? wanted : await this.artRepository.listPendingSourceUrls(payload?.limit ?? BATCH_SIZE);
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
