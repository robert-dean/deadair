import { DateTime } from 'luxon';
import { eventEnvelope, type EventStation } from './event.envelope.js';
import type { EventType } from './types/events.types.js';

/** The event a test delivery sends. Not subscribable: only the test route sends it. */
export const DESTINATION_TEST = 'destination.test';

/** One kind of event the station sends, as `/events/types` describes it. */
interface CatalogueEntry {
    type: string;
    description: string;
    subscribable: boolean;
    /** What `data` holds, filled in with believable values. */
    exampleData: Record<string, unknown>;
}

/**
 * Every kind of event the station sends, in the order the console lists them.
 *
 * A list rather than something each producer registers, on the house rule that what the station can
 * do should be readable in one place. It grows by one row on the day a producer starts sending that
 * event, never before, so the catalogue never offers a subscription to something nothing sends.
 */
const CATALOGUE: readonly CatalogueEntry[] = [
    {
        type: DESTINATION_TEST,
        description:
            'Sent only when somebody presses Send test on a destination, to show it can be reached and the signature checks out. `data` names the destination.',
        subscribable: false,
        exampleData: { destinationId: '7d3c2f5e-8a41-4b6f-9c2d-1e0f3a4b5c6d' },
    },
];

/** A fixed moment and id, so an example reads the same every time it is asked for. */
const EXAMPLE_AT = DateTime.fromISO('2026-10-14T20:14:03.120Z');
const EXAMPLE_ID = '0b9f6a2e-3c1d-4e5f-8a7b-6c5d4e3f2a1b';

/** The catalogue as `/events/types` answers it, each example stamped with this station. */
export function eventTypes(station: EventStation): EventType[] {
    return CATALOGUE.map(entry => ({
        type: entry.type,
        description: entry.description,
        subscribable: entry.subscribable,
        example: eventEnvelope(entry.type, entry.exampleData, station, EXAMPLE_AT, EXAMPLE_ID),
    }));
}
