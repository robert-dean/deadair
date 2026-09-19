import { Container, Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { ActivityRecorder } from '#modules/activity/activity.recorder.js';
import { PlainJob } from '#modules/jobs/plain.job.js';
import { CatalogSyncService, type PluginSyncSummary } from './catalog.sync.service.js';
import { SWEEP_MAX_PERCENT_KEY } from './catalog.sweep.guard.js';
import { scheduledSyncIsDue } from './catalog.sync.schedule.js';

/**
 * Narrows the run to one plugin. Absent means all of them.
 *
 * **Every `send` carries at least one key.** A payload with none is how the job recognises its own
 * cron run, which pg-boss delivers as `null`, and only that run is judged by the schedule settings
 * (see {@link scheduledSyncIsDue}). A send of `{}` would be read as the schedule and could be
 * skipped, so a sender with nothing to narrow says who asked instead.
 */
export interface CatalogSyncPayload {
    pluginId?: string;
    /** Narrows the run to one playlist of `pluginId`, which that walk never sweeps. Ignored without a `pluginId`. */
    playlistId?: string;
    /**
     * Set when an operator asked, which puts the finished walk on the activity feed. Also what keeps
     * a walk of everything from arriving as an empty payload.
     */
    requestedBy?: 'operator';
}

/** The cron run: no payload at all, or one with nothing in it. */
function isScheduledRun(payload?: CatalogSyncPayload): boolean {
    return payload == null || Object.keys(payload).length === 0;
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
        private readonly config: AppConfig,
        context: JobContext,
        container: Container,
        logger: Logger,
    ) {
        super(context, container, logger);
    }

    /**
     * @param payload - Optional in practice as well as in type: a cron-triggered
     *   pg-boss job carries no data at all (`null`, see `takeParentTrace`), and
     *   only something that was sent has keys. The scheduled run is the one
     *   that may be skipped; a sent one always runs.
     */
    protected async execute(payload?: CatalogSyncPayload, signal?: AbortSignal): Promise<void> {
        if (isScheduledRun(payload) && !scheduledSyncIsDue(this.config, new Date())) {
            this.logger.info('catalog sync skipped, the scheduled walk is off or not due this hour', { job: this.context.id });
            return;
        }

        const summaries =
            payload?.pluginId !== undefined && payload.playlistId !== undefined
                ? await this.sync.syncPlaylist(payload.pluginId, payload.playlistId, signal)
                : await this.sync.syncAll(payload?.pluginId, signal);
        for (const summary of summaries) {
            this.logger.info('catalog sync', { job: this.context.id, ...summary });
            this.reportRefusedSweep(summary);
        }
        if (payload?.requestedBy === 'operator') this.reportOperatorRun(summaries, payload.playlistId);
    }

    /**
     * Put a refresh an operator asked for on the feed, once, when it finishes.
     *
     * The button answers "queued" and the walk takes minutes, so without this the operator has no
     * way to learn it happened short of reading the log. Scheduled runs stay off the feed as they
     * always have: nobody is waiting on one. `info`, or `warn` when any source could not be read,
     * which is how the entry reads rather than how bad it is.
     */
    private reportOperatorRun(summaries: readonly PluginSyncSummary[], playlistId?: string): void {
        const created = summaries.reduce((total, summary) => total + summary.created, 0);
        const bound = summaries.reduce((total, summary) => total + summary.bound, 0);
        const failed = summaries.filter(summary => summary.error !== undefined);
        const what = playlistId === undefined ? 'The playlists were read again' : 'The playlist was read again';
        const failures = failed.map(summary => `${summary.pluginId} (${summary.error})`).join(', ');

        void this.activity.record({
            module: 'catalog',
            kind: 'sync.finished',
            severity: failed.length > 0 ? 'warn' : 'info',
            detail:
                summaries.length === 0
                    ? `${what}, but no music source could be asked.`
                    : `${what}: ${bound} records found, ${created} of them new to the station.` +
                      (failed.length > 0 ? ` Not everything could be read: ${failures}.` : ''),
            data: { created, bound, failed: failed.map(summary => summary.pluginId), ...(playlistId === undefined ? {} : { playlistId }) },
        });
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
