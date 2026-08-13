import { z } from 'zod';
import { DateTime } from 'luxon';

const _ZodDatetime = z.preprocess(
    val => (typeof val === 'string' ? DateTime.fromISO(val) : val),
    z.custom<DateTime>(val => val instanceof DateTime && val.isValid, { message: 'Must be in ISO 8601 format' }),
);

/**
 * Which part of the station an entry came from, and the console's one filter axis
 * generated from [ActivityModule](file://./../../../../data/contracts/activity/activity.types.ck#L8)
 */
export const ActivityModule = z.enum(['playout', 'director', 'render', 'catalog', 'plugins']);
export type ActivityModule = z.infer<typeof ActivityModule>;

/**
 * How an entry reads, not how bad it is. There is deliberately no `waiting`: a station idling for
 * want of a listener says so in its own words and stays `info`, for the same reason the transport
 * reports it as `ready` rather than as a mild fault
 * generated from [ActivitySeverity](file://./../../../../data/contracts/activity/activity.types.ck#L13)
 */
export const ActivitySeverity = z.enum(['info', 'warn', 'fault']);
export type ActivitySeverity = z.infer<typeof ActivitySeverity>;

/**
 * One thing that happened, from whichever of the feed's sources holds it
 * generated from [ActivityEntry](file://./../../../../data/contracts/activity/activity.types.ck#L15)
 */
export const ActivityEntry = z.strictObject({
    id: z.string().min(1).max(100).describe('Unique across the whole feed, and half of the cursor below'),
    at: _ZodDatetime.describe('When it happened, as the database recorded it'),
    module: ActivityModule,
    kind: z
        .string()
        .min(1)
        .max(100)
        .describe(
            'Dotted and stable: `silence.cause`, `air.on`, `segment.ready`, `track.aired`. What a console draws a line with, never something a decision is made on',
        ),
    severity: ActivitySeverity,
    detail: z.string().min(1).max(2000).describe('The sentence a person reads, phrased by whatever produced it'),
    data: z.record(z.string(), z.unknown()).optional().describe('The structured half, for a reader that wants to filter or chart rather than read'),
    segmentId: z.string().max(100).optional().describe('The segment this is about, for an entry that came from one'),
    trackId: z.string().max(100).optional().describe('The catalog track this is about, for an entry that came from one'),
});
export type ActivityEntry = z.infer<typeof ActivityEntry>;

/**
 * One page of the feed, newest first
 * generated from [ActivityQuery](file://./../../../../data/contracts/activity/activity.types.ck#L27)
 */
export const ActivityQuery = z.strictObject({
    limit: z.coerce.number().int().min(1).max(200).optional(),
    before: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe(
            'Where the previous page ended. Opaque, and a keyset rather than an offset because rows arrive at the head continuously: an offset would re-show a row on every page as the feed grew under it. Pass back whatever `nextBefore` said and nothing else',
        ),
    module: ActivityModule.optional(),
    minSeverity: ActivitySeverity.optional().describe(
        'The floor, not the exact match: `warn` answers with warnings and faults. Absent is everything',
    ),
});
export type ActivityQuery = z.infer<typeof ActivityQuery>;

/**
 * generated from [ActivityPage](file://./../../../../data/contracts/activity/activity.types.ck#L34)
 */
export const ActivityPage = z.strictObject({
    entries: z.array(ActivityEntry),
    nextBefore: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe('The cursor for the page after this one, absent once the feed has been read to its end'),
});
export type ActivityPage = z.infer<typeof ActivityPage>;
