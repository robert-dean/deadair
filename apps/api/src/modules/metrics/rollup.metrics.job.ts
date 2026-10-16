import { Container, Injectable } from 'injectkit';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { DateTime } from 'luxon';
import { PlainJob } from '#modules/jobs/plain.job.js';
import { MetricsRepository } from './metrics.repository.js';

/**
 * How many complete hours each run folds, newest first.
 *
 * Not just the one that has just closed. The fold is idempotent, so going back costs a few statements
 * and buys two things: a minute flushed late (the flusher's last pass lands after the hour turns) is
 * picked up by the next run, and an hour the job missed because the station was down for a deploy is
 * folded when it comes back rather than lost when its minutes are pruned a week later.
 */
export const ROLLUP_HOURS = 3;

/**
 * Folds the last few complete hours of minute rows into hour rows.
 *
 * A plain `Job` for `PruneActivityJob`'s reasons: nobody waits on it, and a transaction around a
 * handful of idempotent statements buys nothing.
 */
@Injectable()
export class RollupMetricsJob extends PlainJob {
    constructor(
        private readonly metrics: MetricsRepository,
        context: JobContext,
        container: Container,
        logger: Logger,
    ) {
        super(context, container, logger);
    }

    protected async execute(): Promise<void> {
        const thisHour = DateTime.utc().startOf('hour');
        let written = 0;
        for (let back = ROLLUP_HOURS; back >= 1; back -= 1) {
            written += await this.metrics.rollupHour(thisHour.minus({ hours: back }));
        }
        this.logger.debug('metrics: rolled up hours', { job: this.context.id, hours: ROLLUP_HOURS, written });
    }
}
