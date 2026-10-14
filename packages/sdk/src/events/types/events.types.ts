import { DateTime } from 'luxon';
const __dt = (v: unknown, path: string): DateTime => {
    if (typeof v !== 'string') {
        throw new TypeError(`ContractKit: expected an ISO 8601 string at '${path}', received ${typeof v}.`);
    }
    const d = DateTime.fromISO(v);
    if (!d.isValid) throw new TypeError(`ContractKit: '${v}' at '${path}' is not a valid ISO 8601 datetime.`);
    return d;
};

/**
 * Somewhere the station sends what happens on it: an operator's own server, sent a signed POST per event
 * generated from [EventDestination](../../../../../apps/api/data/contracts/events/events.types.ck)
 */
export interface EventDestination {
    id: string;
    /** What the operator calls it */
    name: string;
    /** Where events are POSTed. http or https, and allowed to be on the station's own network. A redirect is never followed */
    url: string;
    /** Off sends nothing */
    enabled: boolean;
    createdAt: DateTime;
    updatedAt: DateTime;
}

export interface EventDestinationInput {
    /** What the operator calls it */
    name: string;
    /** Where events are POSTed. http or https, and allowed to be on the station's own network. A redirect is never followed */
    url: string;
    /** Off sends nothing */
    enabled: boolean;
}

/** Rehydrates every wire-encoded scalar in a EventDestination into its runtime type. Mutates and returns `raw`. */
export function reviveEventDestination(raw: EventDestination): EventDestination {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0['createdAt'] = __dt(__o0['createdAt'], 'EventDestination.createdAt');
    __o0['updatedAt'] = __dt(__o0['updatedAt'], 'EventDestination.updatedAt');
    return raw;
}

/**
 * A new event destination
 * generated from [EventDestinationCreate](../../../../../apps/api/data/contracts/events/events.types.ck)
 */
export interface EventDestinationCreate {
    name: string;
    url: string;
    /** Defaults to on */
    enabled?: boolean;
}

/**
 * Changes to an event destination. Only what is sent changes
 * generated from [EventDestinationUpdate](../../../../../apps/api/data/contracts/events/events.types.ck)
 */
export interface EventDestinationUpdate {
    name?: string;
    url?: string;
    enabled?: boolean;
}

/**
 * The secret deliveries to a destination are signed with. Shown only when it is made, so keep it
 * generated from [EventDestinationSecret](../../../../../apps/api/data/contracts/events/events.types.ck)
 */
export interface EventDestinationSecret {
    /** Put this in the receiver. Each delivery carries `Deadair-Webhook-Signature: v1=<hex HMAC-SHA256 of "<Deadair-Webhook-Timestamp>.<body>">` */
    secret: string;
}

/**
 * One attempt at sending an event to a destination
 * generated from [EventDelivery](../../../../../apps/api/data/contracts/events/events.types.ck)
 */
export interface EventDelivery {
    id: string;
    /** The event's own id, which every attempt at it shares */
    eventId: string;
    eventType: string;
    attempt: number;
    /** `dropped` is an event no longer worth sending, such as a record that finished playing while its destination was down */
    outcome: 'delivered' | 'failed' | 'dropped';
    /** What the destination answered, when it answered at all */
    httpStatus?: number;
    durationMs: number;
    /** What went wrong, in the station's words. Never the destination's response body */
    error?: string;
    createdAt: DateTime;
}

/** Rehydrates every wire-encoded scalar in a EventDelivery into its runtime type. Mutates and returns `raw`. */
export function reviveEventDelivery(raw: EventDelivery): EventDelivery {
    const __o0 = raw as unknown as Record<string, unknown>;
    __o0['createdAt'] = __dt(__o0['createdAt'], 'EventDelivery.createdAt');
    return raw;
}

/**
 * What a test delivery came to
 * generated from [EventTestResult](../../../../../apps/api/data/contracts/events/events.types.ck)
 */
export interface EventTestResult {
    delivered: boolean;
    /** What the destination answered, when it answered at all */
    httpStatus?: number;
    durationMs: number;
    /** Why it was not delivered, in the station's words */
    error?: string;
}

/**
 * Which station sent an event
 * generated from [EventStation](../../../../../apps/api/data/contracts/events/events.types.ck)
 */
export interface EventStation {
    key: string;
    name: string;
}

/**
 * Every event destination, oldest first
 * generated from [EventDestinationList](../../../../../apps/api/data/contracts/events/events.types.ck)
 */
export interface EventDestinationList {
    destinations: EventDestination[];
}

export interface EventDestinationListInput {
    destinations: EventDestinationInput[];
}

/** Rehydrates every wire-encoded scalar in a EventDestinationList into its runtime type. Mutates and returns `raw`. */
export function reviveEventDestinationList(raw: EventDestinationList): EventDestinationList {
    const __o0 = raw as unknown as Record<string, unknown>;
    {
        const __a1 = __o0['destinations'] as unknown[];
        for (let __i2 = 0; __i2 < __a1.length; __i2++) {
            reviveEventDestination(__a1[__i2] as never);
        }
    }
    return raw;
}

/**
 * A destination just made, with its secret
 * generated from [EventDestinationCreated](../../../../../apps/api/data/contracts/events/events.types.ck)
 */
export type EventDestinationCreated = EventDestination & EventDestinationSecret;
export type EventDestinationCreatedInput = EventDestinationInput & EventDestinationSecret;

/** Rehydrates every wire-encoded scalar in a EventDestinationCreated into its runtime type. Mutates and returns `raw`. */
export function reviveEventDestinationCreated(raw: EventDestinationCreated): EventDestinationCreated {
    const __v = [raw] as unknown[];
    reviveEventDestination(__v[0] as never);
    return __v[0] as EventDestinationCreated;
}

/**
 * A destination's latest delivery attempts, newest first. The station keeps the latest fifty
 * generated from [EventDeliveryList](../../../../../apps/api/data/contracts/events/events.types.ck)
 */
export interface EventDeliveryList {
    deliveries: EventDelivery[];
}

/** Rehydrates every wire-encoded scalar in a EventDeliveryList into its runtime type. Mutates and returns `raw`. */
export function reviveEventDeliveryList(raw: EventDeliveryList): EventDeliveryList {
    const __o0 = raw as unknown as Record<string, unknown>;
    {
        const __a1 = __o0['deliveries'] as unknown[];
        for (let __i2 = 0; __i2 < __a1.length; __i2++) {
            reviveEventDelivery(__a1[__i2] as never);
        }
    }
    return raw;
}

/**
 * One event, as a destination receives it. The same shape for every type: read `type`, then `data`
 * generated from [EventEnvelope](../../../../../apps/api/data/contracts/events/events.types.ck)
 */
export interface EventEnvelope {
    /** The event's own id. A redelivery of the same event carries the same one */
    id: string;
    /** What happened, such as `track.started` */
    type: string;
    /** When, as an ISO-8601 instant in UTC */
    occurredAt: string;
    station: EventStation;
    /** What the type says it holds. `/events/types` gives an example of each */
    data: Record<string, unknown>;
}

/**
 * One kind of event the station sends
 * generated from [EventType](../../../../../apps/api/data/contracts/events/events.types.ck)
 */
export interface EventType {
    type: string;
    /** When it is sent, and what its `data` holds */
    description: string;
    /** False for the test event, which only a test delivery sends */
    subscribable: boolean;
    example: EventEnvelope;
}

/**
 * Every kind of event the station sends
 * generated from [EventTypeList](../../../../../apps/api/data/contracts/events/events.types.ck)
 */
export interface EventTypeList {
    types: EventType[];
}
