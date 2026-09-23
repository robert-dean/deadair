import { Container, Injectable } from 'injectkit';
import { DateTime } from 'luxon';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { PlainJob } from '#modules/jobs/plain.job.js';
import { DeadairOAuthClientRepository } from './repositories/oauth.client.repository.js';

/**
 * The nightly sweep of apps that registered themselves and have not been back.
 *
 * Claude registers a new client each time somebody connects it (RFC 7591 dynamic registration), so
 * a station somebody reconnects now and then collects clients nothing will use again. Each one
 * expires ninety days after it was last used, every use pushing that out, and the library never
 * deletes one itself. A client an operator created has no expiry and is never touched here.
 *
 * Deleting a client ends nothing a person approved: their grant and its tokens are keyed on the
 * client id, and a client that has not been used in ninety days holds no refresh token that is
 * still alive. A plain `Job`, for `PruneActivityJob`'s reason.
 */
@Injectable()
export class ExpireOAuthClientsJob extends PlainJob {
    constructor(
        private readonly clients: DeadairOAuthClientRepository,
        context: JobContext,
        container: Container,
        logger: Logger,
    ) {
        super(context, container, logger);
    }

    protected async execute(): Promise<void> {
        const removed = await this.clients.deleteExpired(DateTime.utc());
        if (removed > 0) this.logger.info('oauth: deleted apps that registered themselves and lapsed', { job: this.context.id, removed });
    }
}
