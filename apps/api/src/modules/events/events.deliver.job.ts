import { Container, Injectable } from 'injectkit';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { PlainJob } from '#modules/jobs/plain.job.js';
import { EventDeliverer, type DeliverPayload } from './event.deliverer.js';

export type { DeliverPayload };

/**
 * Send one event to one destination. The rules are {@link EventDeliverer}'s; this is the broker's
 * handle on them. An attempt worth repeating THROWS, which is what hands it to the broker's retry.
 */
@Injectable()
export class EventsDeliverJob extends PlainJob<Partial<DeliverPayload>> {
    constructor(
        private readonly deliverer: EventDeliverer,
        context: JobContext,
        container: Container,
        logger: Logger,
    ) {
        super(context, container, logger);
    }

    protected async execute(payload?: Partial<DeliverPayload>, signal?: AbortSignal): Promise<void> {
        const { destinationId, envelope, notAfter, state } = payload ?? {};
        if (typeof destinationId !== 'string' || typeof envelope !== 'object' || envelope === null || typeof notAfter !== 'number') return;

        await this.deliverer.deliver({ destinationId, envelope, notAfter, state: state === true }, signal);
    }
}
