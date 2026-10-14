import { randomUUID } from 'node:crypto';
import type { DateTime } from 'luxon';
import type { EventEnvelope, EventStation } from './types/events.types.js';

export type { EventEnvelope, EventStation };

/**
 * Wrap one event's data for sending. `id` is minted here unless the caller already holds one.
 *
 * The envelope is the same shape for every type (`events.types.ck`), so a receiver reads `type` and
 * then knows what `data` holds. JSON-safe because it is SENT: the time is an ISO-8601 string in UTC
 * and every duration inside `data` is integer milliseconds. `id` is the event's own, minted once and
 * kept across retries, so a receiver that saw it already can tell a redelivery from a second event.
 *
 * Not to be confused with a row of `deadair.station_events`, which is the activity feed's record of a
 * moment written for a person to read. This is the same kind of moment written for a machine.
 */
export function eventEnvelope(
    type: string,
    data: Record<string, unknown>,
    station: EventStation,
    occurredAt: DateTime,
    id: string = randomUUID(),
): EventEnvelope {
    return { id, type, occurredAt: occurredAt.toUTC().toISO()!, station, data };
}
