import { Container, Injectable } from 'injectkit';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { PlainJob } from '#modules/jobs/plain.job.js';
import { PodcastsService } from './podcasts.service.js';

/**
 * Read every show's feed and remember the episodes it lists.
 *
 * A plain job, not a transactional one, for `PlainJob`'s own reason: a refresh is a walk with a
 * network read in the middle of every step, and a transaction held across it would pin a connection
 * for minutes. Each show's episodes are written on their own, idempotently, so an overlapping run
 * costs repeated reads and never a wrong row.
 *
 * One log line per run and nothing on the activity feed. A refresh that found nothing new is every
 * run of a quiet week, and a feed line saying so every half hour would bury the lines that matter;
 * what an operator wants to see is an episode the station FETCHED, which is a different job's line.
 */
@Injectable()
export class RefreshPodcastsJob extends PlainJob {
    constructor(
        private readonly podcasts: PodcastsService,
        context: JobContext,
        container: Container,
        logger: Logger,
    ) {
        super(context, container, logger);
    }

    protected async execute(_payload?: unknown, signal?: AbortSignal): Promise<void> {
        // A station with no podcast plugin has nothing to refresh, and says nothing about it: this runs
        // every half hour on every station whether or not anybody subscribed to anything.
        if (!this.podcasts.hasPodcasts()) return;

        const summary = await this.podcasts.refresh(signal);
        if (summary.shows === 0) return;

        const fields = { job: this.context.id, shows: summary.shows, listed: summary.listed, added: summary.added };
        if (summary.failed.length > 0)
            this.logger.warn('podcasts: refreshed, and some shows could not be read', { ...fields, failed: summary.failed });
        else this.logger.info('podcasts: refreshed', fields);
    }
}
