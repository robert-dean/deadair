import { z } from 'zod';
import { DateTime } from 'luxon';

const _ZodDatetime = z.preprocess(
    val => (typeof val === 'string' ? DateTime.fromISO(val) : val),
    z.custom<DateTime>(val => val instanceof DateTime && val.isValid, { message: 'Must be in ISO 8601 format' }),
);

/**
 * One record the station actually played
 * generated from [HistoryEntry](../../../../data/contracts/history/history.types.ck)
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
 * generated from [HistoryQuery](../../../../data/contracts/history/history.types.ck)
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
 * What one line of the as-run log is.
 *
 *   record, break, programme   something that went out, with when it started and, once the station saw it end, when it ended
 *   gap                        the station aired its local bed instead of the running order. Only gaps long enough to matter are recorded
 *   onAir, offAir              the station was put on air, or stood down
 * generated from [AsRunKind](../../../../data/contracts/history/history.types.ck)
 */
export const AsRunKind = z.enum(['record', 'break', 'programme', 'gap', 'onAir', 'offAir']);
export type AsRunKind = z.infer<typeof AsRunKind>;

/**
 * One page of the as-run log, newest first
 * generated from [AsRunQuery](../../../../data/contracts/history/history.types.ck)
 */
export const AsRunQuery = z.strictObject({
    limit: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(1).max(500)).optional(),
    before: z.string().min(1).max(200).optional().describe('Where the previous page ended. Opaque: pass back whatever `nextBefore` said'),
    until: _ZodDatetime
        .optional()
        .describe('Start reading from this moment back, to jump to an hour without paging to it. Ignored when `before` is sent'),
});
export type AsRunQuery = z.infer<typeof AsRunQuery>;

/**
 * generated from [HistoryPage](../../../../data/contracts/history/history.types.ck)
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

/**
 * One line of what actually went out
 * generated from [AsRunEntry](../../../../data/contracts/history/history.types.ck)
 */
export const AsRunEntry = z.strictObject({
    id: z.string().min(1).max(100).describe('Unique across the log, and half of the cursor below'),
    kind: AsRunKind,
    at: _ZodDatetime.describe('When it started. For an item, the moment the player said so, not when it was handed over'),
    endedAt: _ZodDatetime
        .optional()
        .describe('When it stopped. Absent while an item is on air, and for one the station never saw end, such as the last item before a crash'),
    title: z.string().max(500).optional().describe("A record's title or a break's label, as it went out"),
    artists: z.string().max(1000).optional().describe("A record's credit as written, whole"),
    trackId: z.string().max(100).optional().describe('The catalog track a record was'),
    segmentId: z.string().max(100).optional().describe('The segment a break or a programme was'),
    passedOver: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0))
        .optional()
        .describe('How many items already handed to the player it moved past to reach this one. They never aired. Absent when none'),
    detail: z.string().max(2000).optional().describe("For a gap or an air change, the station's own sentence about it"),
    pickedBecause: z.string().max(200).optional().describe('For a record the model picked while asked to say why, its reason in its own words'),
});
export type AsRunEntry = z.infer<typeof AsRunEntry>;

/**
 * generated from [AsRunPage](../../../../data/contracts/history/history.types.ck)
 */
export const AsRunPage = z.strictObject({
    entries: z.array(AsRunEntry),
    nextBefore: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe('The cursor for the page after this one, absent once the log has been read to its end'),
});
export type AsRunPage = z.infer<typeof AsRunPage>;
