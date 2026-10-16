import { Container, Injectable } from 'injectkit';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { PlainJob } from '#modules/jobs/plain.job.js';
import { MetricsRepository } from './metrics.repository.js';
import { resolveHourRetentionDays, resolveMinuteRetentionDays } from './metrics.settings.js';

/**
 * The nightly sweep over the station's numbers: minute rows past their window, then hour rows past
 * theirs.
 *
 * Shaped on `PruneActivityJob`, windows read per run so an operator's change applies tonight. The two
 * resolutions are swept independently: a station keeping every hour forever (`0`) still sweeps its
 * minutes, which is the case that matters for disk.
 */
@Injectable()
export class PruneMetricsJob extends PlainJob {
    constructor(
        private readonly metrics: MetricsRepository,
        private readonly config: AppConfig,
        context: JobContext,
        container: Container,
        logger: Logger,
    ) {
        super(context, container, logger);
    }

    protected async execute(): Promise<void> {
        const minuteDays = resolveMinuteRetentionDays(this.config);
        const hourDays = resolveHourRetentionDays(this.config);

        const minutes = await this.metrics.pruneOlderThanDays('minute', minuteDays);
        const hours = await this.metrics.pruneOlderThanDays('hour', hourDays);

        // Quiet when there was nothing old enough, which is every night for a station's first week.
        if (minutes + hours > 0) this.logger.info('metrics: swept old samples', { job: this.context.id, minutes, hours, minuteDays, hourDays });
    }
}
