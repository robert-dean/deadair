import { Container, Injectable } from 'injectkit';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { ActivityRecorder } from '#modules/activity/activity.recorder.js';
import { PlainJob } from '#modules/jobs/plain.job.js';
import { CatalogSyncService, type PluginSyncSummary } from './catalog.sync.service.js';
import { SWEEP_MAX_PERCENT_KEY } from './catalog.sweep.guard.js';

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
        private readonly activity: ActivityRecorder,
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
            this.reportRefusedSweep(summary);
        }
    }

    /**
     * Put a refused sweep on the feed, because the operator who needs to know is not reading logs.
     *
     * Only the proportional refusal, not the empty-walk one: a provider that answered with nothing
     * is an outage, it is already at `warn`, and it resolves itself on the next hour. This one does
     * not resolve itself — it means the ids this provider hands out have all changed, and the
     * station will go on refusing every hour until somebody looks.
     *
     * `warn` rather than `fault`, on the severity rule that it is how an entry reads rather than how
     * bad it is: the station has DECLINED to narrow its own rotation. Nothing is off the air, and
     * the copies that really are gone are still benched one at a time by the audio path. One row
     * carrying the counts, like the cache sweep, rather than one per binding.
     */
    private reportRefusedSweep(summary: PluginSyncSummary): void {
        const sweep = summary.sweep;
        if (sweep?.kind !== 'refused' || sweep.reason !== 'too-many') return;

        void this.activity.record({
            module: 'catalog',
            kind: 'sweep.refused',
            severity: 'warn',
            detail:
                `A sync of ${summary.pluginId} recognised only ${sweep.known - sweep.unseen} of the ${sweep.known} copies the station ` +
                `has from it, so it refused to retire the other ${sweep.unseen} rather than acting on a library it did not recognise. ` +
                `This is what a provider renumbering its own ids looks like. Nothing has been taken out of rotation, and copies that ` +
                `really are gone are still dropped one at a time when their audio does not arrive. Raise ${SWEEP_MAX_PERCENT_KEY} if ` +
                `the library really did change this much.`,
            data: { pluginId: summary.pluginId, known: sweep.known, unseen: sweep.unseen },
        });
    }
}
