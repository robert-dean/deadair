import { Container, Injectable } from 'injectkit';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { PlainJob } from '#modules/jobs/plain.job.js';
import { StationEventsRepository } from './station.events.repository.js';
import { resolveActivityRetentionDays } from './activity.settings.js';

/**
 * The nightly sweep over the station's own moments.
 *
 * Shaped on `PruneScriptHistoryJob` down to the reasoning, because it is the same job over a
 * different table: one statement, the window read HERE per run rather than captured at
 * construction so an operator lowering it gets tonight's sweep rather than the one after a
 * restart, and a plain `Job` rather than a `TransactionalJob` because nobody is waiting on it and
 * wrapping it would pin a runtime-pool connection for no atomicity worth having.
 *
 * It sweeps `station_events` only. The feed's other two sources have their own lifetimes already
 * and this module reads them rather than owning them.
 *
 * Nothing about the station depends on this running. A sweep that never runs costs disk; a sweep
 * that runs when the operator meant to keep everything costs the only record of a night they have
 * forgotten, which is why `0` is checked in the repository as well as read here.
 */
@Injectable()
export class PruneActivityJob extends PlainJob {
    constructor(
        private readonly events: StationEventsRepository,
        private readonly config: AppConfig,
        context: JobContext,
        container: Container,
        logger: Logger,
    ) {
        super(context, container, logger);
    }

    protected async execute(): Promise<void> {
        const days = resolveActivityRetentionDays(this.config);
        if (days <= 0) {
            // Debug rather than info: on a station keeping everything this is every night, and a
            // nightly line saying nothing happened is how a log stops being read.
            this.logger.debug('activity: keeping every event, so nothing was swept', { job: this.context.id });
            return;
        }

        const removed = await this.events.pruneOlderThanDays(days);

        // Quiet when there was nothing old enough, which is every night on a young station.
        if (removed > 0) this.logger.info('activity: swept old events', { job: this.context.id, removed, days });
    }
}
