import { Container, Injectable } from 'injectkit';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { PlainJob } from '#modules/jobs/plain.job.js';
import { RequestDesk } from './request.desk.js';

/**
 * Offer every pending request to the running order again, and let go of the ones that waited too long.
 *
 * A cron rather than a loop: a request that is waiting on its audio or on a quiet place near the head
 * of the order is waiting on something measured in minutes, and a minute's cron is the retry.
 */
@Injectable()
export class RequestsTickJob extends PlainJob {
    constructor(
        private readonly desk: RequestDesk,
        context: JobContext,
        container: Container,
        logger: Logger,
    ) {
        super(context, container, logger);
    }

    protected async execute(): Promise<void> {
        const placed = await this.desk.tick();
        if (placed > 0) this.logger.info('requests: placed waiting requests in the running order', { job: this.context.id, placed });
    }
}
