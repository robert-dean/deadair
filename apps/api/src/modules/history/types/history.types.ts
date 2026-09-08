import { z } from 'zod';
import { DateTime } from 'luxon';

const _ZodDatetime = z.preprocess(
    val => (typeof val === 'string' ? DateTime.fromISO(val) : val),
    z.custom<DateTime>(val => val instanceof DateTime && val.isValid, { message: 'Must be in ISO 8601 format' }),
);

/**
 * One record the station actually played
 * generated from [HistoryEntry](../../../../data/contracts/history/history.types.ck#L7)
 */
export const HistoryEntry = z.strictObject({
    id: z.string().min(1).max(100).describe('Unique across the history, and half of the cursor below'),
    airedAt: _ZodDatetime.describe('When it started, written when it began rather than when it was handed to the player'),
    title: z.string().min(1).max(500),
    artists: z
        .string()
        .min(1)
        .max(1000)
        .describe(
            'The credit as written, whole: one line rather than a list, because that is the shape a release credits itself in and splitting it renames acts with a comma in their name',
        ),
    album: z.string().max(500).optional().describe('Absent for anything aired straight from a provider, which the catalog holds no record for'),
    artworkUrl: z
        .string()
        .max(2000)
        .optional()
        .describe(
            "The station's own copy where it has one, as a path under the API root, and the upstream URL until then. Resolve it against the base the station is reached at",
        ),
    durationMs: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0))
        .optional()
        .describe('How long the recording runs, from the catalog rather than from the copy that played'),
    trackId: z
        .string()
        .max(100)
        .optional()
        .describe(
            'The catalog track this was, for a client that wants to ask more about it. Absent for a record the catalog does not hold, and for one it has since forgotten',
        ),
});
export type HistoryEntry = z.infer<typeof HistoryEntry>;

/**
 * One page of the history, newest first
 * generated from [HistoryQuery](../../../../data/contracts/history/history.types.ck#L18)
 */
export const HistoryQuery = z.strictObject({
    limit: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(1).max(200)).optional(),
    before: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe(
            'Where the previous page ended. Opaque, and a keyset rather than an offset because rows arrive at the head continuously: an offset would re-show a row on every page as the station kept playing under it. Pass back whatever `nextBefore` said and nothing else',
        ),
});
export type HistoryQuery = z.infer<typeof HistoryQuery>;

/**
 * generated from [HistoryPage](../../../../data/contracts/history/history.types.ck#L23)
 */
export const HistoryPage = z.strictObject({
    entries: z.array(HistoryEntry),
    nextBefore: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe('The cursor for the page after this one, absent once the history has been read to its end'),
});
export type HistoryPage = z.infer<typeof HistoryPage>;
