import { randomUUID } from 'node:crypto';
import type { DateTime } from 'luxon';

/** Which station said it, so one receiver can tell two stations apart. */
export interface EventStation {
    key: string;
    name: string;
}

/**
 * One event as a destination receives it: the same shape for every type, so a receiver reads `type`
 * and then knows what `data` holds.
 *
 * JSON-safe because it is SENT: the time is an ISO-8601 string and every duration inside `data` is
 * integer milliseconds. `id` is the event's own, minted once and kept across retries, so a receiver
 * that saw it already can tell a redelivery from a second event.
 *
 * Not to be confused with a row of `deadair.station_events`, which is the activity feed's record of
 * a moment written for a person to read. This is the same kind of moment written for a machine.
 */
export interface EventEnvelope<TType extends string = string, TData extends Record<string, unknown> = Record<string, unknown>> {
    id: string;
    type: TType;
    occurredAt: string;
    station: EventStation;
    data: TData;
}

/** Wrap one event's data for sending. `id` is minted here unless the caller already holds one. */
export function eventEnvelope<TType extends string, TData extends Record<string, unknown>>(
    type: TType,
    data: TData,
    station: EventStation,
    occurredAt: DateTime,
    id: string = randomUUID(),
): EventEnvelope<TType, TData> {
    return { id, type, occurredAt: occurredAt.toUTC().toISO()!, station, data };
}
