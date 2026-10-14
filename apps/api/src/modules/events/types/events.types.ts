import { z } from 'zod';
import { DateTime } from 'luxon';

const _ZodDatetime = z.preprocess(
    val => (typeof val === 'string' ? DateTime.fromISO(val) : val),
    z.custom<DateTime>(val => val instanceof DateTime && val.isValid, { message: 'Must be in ISO 8601 format' }),
);

/**
 * Somewhere the station sends what happens on it: an operator's own server, sent a signed POST per event
 * generated from [EventDestination](../../../../data/contracts/events/events.types.ck)
 */
export const EventDestination = z.strictObject({
    id: z.uuid(),
    name: z.string().min(1).max(200).describe('What the operator calls it'),
    url: z
        .string()
        .min(1)
        .max(2000)
        .describe("Where events are POSTed. http or https, and allowed to be on the station's own network. A redirect is never followed"),
    enabled: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()).describe('Off sends nothing'),
    createdAt: _ZodDatetime,
    updatedAt: _ZodDatetime,
});
export type EventDestination = z.infer<typeof EventDestination>;

export const EventDestinationInput = z.strictObject({
    name: z.string().min(1).max(200).describe('What the operator calls it'),
    url: z
        .string()
        .min(1)
        .max(2000)
        .describe("Where events are POSTed. http or https, and allowed to be on the station's own network. A redirect is never followed"),
    enabled: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()).describe('Off sends nothing'),
});
export type EventDestinationInput = z.infer<typeof EventDestinationInput>;

/**
 * A new event destination
 * generated from [EventDestinationCreate](../../../../data/contracts/events/events.types.ck)
 */
export const EventDestinationCreate = z.strictObject({
    name: z.string().min(1).max(200),
    url: z.string().min(1).max(2000),
    enabled: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .optional()
        .describe('Defaults to on'),
});
export type EventDestinationCreate = z.infer<typeof EventDestinationCreate>;

/**
 * Changes to an event destination. Only what is sent changes
 * generated from [EventDestinationUpdate](../../../../data/contracts/events/events.types.ck)
 */
export const EventDestinationUpdate = z.strictObject({
    name: z.string().min(1).max(200).optional(),
    url: z.string().min(1).max(2000).optional(),
    enabled: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()).optional(),
});
export type EventDestinationUpdate = z.infer<typeof EventDestinationUpdate>;

/**
 * The secret deliveries to a destination are signed with. Shown only when it is made, so keep it
 * generated from [EventDestinationSecret](../../../../data/contracts/events/events.types.ck)
 */
export const EventDestinationSecret = z.strictObject({
    secret: z
        .string()
        .describe(
            'Put this in the receiver. Each delivery carries `Deadair-Webhook-Signature: v1=<hex HMAC-SHA256 of "<Deadair-Webhook-Timestamp>.<body>">`',
        ),
});
export type EventDestinationSecret = z.infer<typeof EventDestinationSecret>;

/**
 * One attempt at sending an event to a destination
 * generated from [EventDelivery](../../../../data/contracts/events/events.types.ck)
 */
export const EventDelivery = z.strictObject({
    id: z.uuid(),
    eventId: z.uuid().describe("The event's own id, which every attempt at it shares"),
    eventType: z.string().max(100),
    attempt: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(1)),
    outcome: z
        .enum(['delivered', 'failed', 'dropped'])
        .describe('`dropped` is an event no longer worth sending, such as a record that finished playing while its destination was down'),
    httpStatus: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int())
        .optional()
        .describe('What the destination answered, when it answered at all'),
    durationMs: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0)),
    error: z.string().max(1000).optional().describe("What went wrong, in the station's words. Never the destination's response body"),
    createdAt: _ZodDatetime,
});
export type EventDelivery = z.infer<typeof EventDelivery>;

/**
 * What a test delivery came to
 * generated from [EventTestResult](../../../../data/contracts/events/events.types.ck)
 */
export const EventTestResult = z.strictObject({
    delivered: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()),
    httpStatus: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int())
        .optional()
        .describe('What the destination answered, when it answered at all'),
    durationMs: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0)),
    error: z.string().max(1000).optional().describe("Why it was not delivered, in the station's words"),
});
export type EventTestResult = z.infer<typeof EventTestResult>;

/**
 * Which station sent an event
 * generated from [EventStation](../../../../data/contracts/events/events.types.ck)
 */
export const EventStation = z.strictObject({
    key: z.string(),
    name: z.string(),
});
export type EventStation = z.infer<typeof EventStation>;

/**
 * Every event destination, oldest first
 * generated from [EventDestinationList](../../../../data/contracts/events/events.types.ck)
 */
export const EventDestinationList = z.strictObject({
    destinations: z.array(EventDestination),
});
export type EventDestinationList = z.infer<typeof EventDestinationList>;

export const EventDestinationListInput = z.strictObject({
    destinations: z.array(EventDestinationInput),
});
export type EventDestinationListInput = z.infer<typeof EventDestinationListInput>;

/**
 * A destination just made, with its secret
 * generated from [EventDestinationCreated](../../../../data/contracts/events/events.types.ck)
 */
export const EventDestinationCreated = EventDestination.extend(EventDestinationSecret.shape);
export type EventDestinationCreated = z.infer<typeof EventDestinationCreated>;
export const EventDestinationCreatedInput = EventDestinationInput.extend(EventDestinationSecret.shape);
export type EventDestinationCreatedInput = z.infer<typeof EventDestinationCreatedInput>;

/**
 * A destination's latest delivery attempts, newest first. The station keeps the latest fifty
 * generated from [EventDeliveryList](../../../../data/contracts/events/events.types.ck)
 */
export const EventDeliveryList = z.strictObject({
    deliveries: z.array(EventDelivery),
});
export type EventDeliveryList = z.infer<typeof EventDeliveryList>;

/**
 * One event, as a destination receives it. The same shape for every type: read `type`, then `data`
 * generated from [EventEnvelope](../../../../data/contracts/events/events.types.ck)
 */
export const EventEnvelope = z.strictObject({
    id: z.uuid().describe("The event's own id. A redelivery of the same event carries the same one"),
    type: z.string().max(100).describe('What happened, such as `track.started`'),
    occurredAt: z.string().describe('When, as an ISO-8601 instant in UTC'),
    station: EventStation,
    data: z.record(z.string(), z.unknown()).describe('What the type says it holds. `/events/types` gives an example of each'),
});
export type EventEnvelope = z.infer<typeof EventEnvelope>;

/**
 * One kind of event the station sends
 * generated from [EventType](../../../../data/contracts/events/events.types.ck)
 */
export const EventType = z.strictObject({
    type: z.string().max(100),
    description: z.string().describe('When it is sent, and what its `data` holds'),
    subscribable: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe('False for the test event, which only a test delivery sends'),
    example: EventEnvelope,
});
export type EventType = z.infer<typeof EventType>;

/**
 * Every kind of event the station sends
 * generated from [EventTypeList](../../../../data/contracts/events/events.types.ck)
 */
export const EventTypeList = z.strictObject({
    types: z.array(EventType),
});
export type EventTypeList = z.infer<typeof EventTypeList>;
