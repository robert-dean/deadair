import { Container, Injectable } from 'injectkit';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { PlainJob } from '#modules/jobs/plain.job.js';
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
 */
@Injectable()
export class CatalogSyncJob extends PlainJob<CatalogSyncPayload> {
    constructor(
        private readonly sync: CatalogSyncService,
        context: JobContext,
        container: Container,
        logger: Logger,
    ) {
        super(context, container, logger);
    }

    /**
     * @param payload - Optional in practice as well as in type: a cron-triggered
     *   pg-boss job carries no data at all, so this arrives `undefined` on every
     *   scheduled run and only ever has a `pluginId` when something sent one.
     */
    protected async execute(payload?: CatalogSyncPayload, signal?: AbortSignal): Promise<void> {
        const summaries = await this.sync.syncAll(payload?.pluginId, signal);
        for (const summary of summaries) {
            this.logger.info('catalog sync', { job: this.context.id, ...summary });
        }
    }
}
