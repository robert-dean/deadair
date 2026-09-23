import { Container, Injectable } from 'injectkit';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { PlainJob } from '#modules/jobs/plain.job.js';
import { NarrationsService } from './narrations.service.js';

/**
 * Read every series and remember the pieces it holds.
 *
 * `RefreshPodcastsJob`'s shape and its reasons: a plain job rather than a transactional one, because
 * a refresh is a walk with a network read in the middle of every step and a transaction held across
 * it would pin a connection for minutes. Each series' pieces are written on their own, idempotently,
 * so an overlapping run costs repeated reads and never a wrong row.
 *
 * One log line per run and nothing on the activity feed. What an operator wants to see is a chapter
 * the station SPOKE, which is a different job's line.
 */
@Injectable()
export class RefreshNarrationsJob extends PlainJob {
    constructor(
        private readonly narrations: NarrationsService,
        context: JobContext,
        container: Container,
        logger: Logger,
    ) {
        super(context, container, logger);
    }

    protected async execute(_payload?: unknown, signal?: AbortSignal): Promise<void> {
        // A station with no narration plugin has nothing to refresh, and says nothing about it: this
        // runs on every station whether or not anybody has given it anything to read.
        if (!this.narrations.hasNarrations()) return;

        const summary = await this.narrations.refresh(signal);
        if (summary.series === 0) return;

        const fields = { job: this.context.id, series: summary.series, listed: summary.listed, added: summary.added, withdrawn: summary.withdrawn };
        if (summary.failed.length > 0)
            this.logger.warn('narrations: refreshed, and some series could not be read', { ...fields, failed: summary.failed });
        else this.logger.info('narrations: refreshed', fields);
    }
}
