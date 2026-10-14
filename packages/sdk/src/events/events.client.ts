import type { SdkFetch } from '../sdk-options.js';
import { bigIntReplacer, parseJson } from '../sdk-options.js';
import type {
    EventDeliveryList,
    EventDestination,
    EventDestinationCreate,
    EventDestinationCreated,
    EventDestinationList,
    EventDestinationSecret,
    EventDestinationUpdate,
    EventTestResult,
    EventTypeList,
} from './types/events.types.js';
import { reviveEventDeliveryList, reviveEventDestination, reviveEventDestinationCreated, reviveEventDestinationList } from './types/events.types.js';

export class EventsClient {
    constructor(private fetch: SdkFetch) {}

    /**
     * @name List event types
     * @description Every kind of event the station sends, each with an example of what a destination receives
     */
    async listEventTypes(): Promise<EventTypeList> {
        const result = await this.fetch(`/events/types`, { method: 'GET' });
        return await parseJson<EventTypeList>(result);
    }

    /**
     * @name List event destinations
     * @description Every event destination, oldest first
     */
    async listEventDestinations(): Promise<EventDestinationList> {
        const result = await this.fetch(`/events/destinations`, { method: 'GET' });
        return reviveEventDestinationList(await parseJson<EventDestinationList>(result));
    }

    /**
     * @name Create event destination
     * @description Add an event destination. The answer carries its signing secret, which is not shown again
     */
    async createEventDestination(body: EventDestinationCreate): Promise<EventDestinationCreated> {
        const result = await this.fetch(`/events/destinations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return reviveEventDestinationCreated(await parseJson<EventDestinationCreated>(result));
    }

    /**
     * @name Update event destination
     * @description Change an event destination's name, address, or whether it is on
     */
    async updateEventDestination(id: string, body: EventDestinationUpdate): Promise<EventDestination> {
        const result = await this.fetch(`/events/destinations/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return reviveEventDestination(await parseJson<EventDestination>(result));
    }

    /**
     * @name Delete event destination
     * @description Remove an event destination and its delivery log
     */
    async deleteEventDestination(id: string): Promise<void> {
        await this.fetch(`/events/destinations/${encodeURIComponent(id)}`, { method: 'DELETE' });
    }

    /**
     * @name Rotate event destination secret
     * @description Make a new signing secret for a destination. The old one stops working at once
     */
    async rotateEventDestinationSecret(id: string): Promise<EventDestinationSecret> {
        const result = await this.fetch(`/events/destinations/${encodeURIComponent(id)}/secret`, { method: 'POST' });
        return await parseJson<EventDestinationSecret>(result);
    }

    /**
     * @name Test event destination
     * @description Send a destination a test event now, and say what it answered. Sent even when the destination is off
     */
    async testEventDestination(id: string): Promise<EventTestResult> {
        const result = await this.fetch(`/events/destinations/${encodeURIComponent(id)}/test`, { method: 'POST' });
        return await parseJson<EventTestResult>(result);
    }

    /**
     * @name List event deliveries
     * @description A destination's latest delivery attempts, newest first
     */
    async listEventDeliveries(id: string): Promise<EventDeliveryList> {
        const result = await this.fetch(`/events/destinations/${encodeURIComponent(id)}/deliveries`, { method: 'GET' });
        return reviveEventDeliveryList(await parseJson<EventDeliveryList>(result));
    }
}
