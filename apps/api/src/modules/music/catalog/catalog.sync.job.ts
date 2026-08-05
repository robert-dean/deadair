import { Container, Injectable, ScopedContainer } from 'injectkit';
import { Job, JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { overrideJobActor } from '#modules/jobs/job.authorization.js';
import { CatalogSyncService } from './catalog.sync.service.js';

/** Narrows the run to one plugin. Absent — as it always is from cron — means all of them. */
export interface CatalogSyncPayload {
    pluginId?: string;
}

/**
 * The scheduled catalog fill.
 *
 * A plain `Job` rather than a `TransactionalJob`, deliberately. This is a long
 * walk with a network round trip per page, and wrapping it would pin a
 * runtime-pool connection and hold one snapshot open for the length of the
 * walk. `TransactionalJob`'s own guidance is the rule being followed: bounded
 * unit of work extends it, loops transact per item — which is what
 * `CatalogResolverService.ingestTrack` does.
 *
 * Because it is not transactional, the actor has to be installed here; nothing
 * else in a plain job's scope does it.
 */
@Injectable()
export class CatalogSyncJob implements Job<CatalogSyncPayload> {
    constructor(
        private readonly sync: CatalogSyncService,
        private readonly context: JobContext,
        // `Container` resolves to the container doing the resolving, which for a
        // job is the runner's per-execution scope. `ScopedContainer` is a type
        // alias, not a token, so it can only be the cast — same as TransactionalJob.
        private readonly container: Container,
        private readonly logger: Logger,
    ) {}

    /**
     * @param payload - Optional in practice as well as in type: a cron-triggered
     *   pg-boss job carries no data at all, so this arrives `undefined` on every
     *   scheduled run and only ever has a `pluginId` when something sent one.
     */
    async run(payload?: CatalogSyncPayload, signal?: AbortSignal): Promise<void> {
        overrideJobActor(this.container as ScopedContainer, this.context);

        const summaries = await this.sync.syncAll(payload?.pluginId, signal);
        for (const summary of summaries) {
            this.logger.info('catalog sync', { job: this.context.id, ...summary });
        }
    }
}
