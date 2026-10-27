import { z } from 'zod';
import { DateTime } from 'luxon';

const _ZodDatetime = z.preprocess(
    val => (typeof val === 'string' ? DateTime.fromISO(val) : val),
    z.custom<DateTime>(val => val instanceof DateTime && val.isValid, { message: 'Must be in ISO 8601 format' }),
);

/**
 * What a recording holds: a live show, or an hour of the station's own programme.
 * generated from [RecordingKind](../../../../data/contracts/stream/stream.archive.types.ck)
 */
export const RecordingKind = z.enum(['live', 'hour']);
export type RecordingKind = z.infer<typeof RecordingKind>;

/**
 * One file in the station's archive of what it aired.
 * generated from [Recording](../../../../data/contracts/stream/stream.archive.types.ck)
 */
export const Recording = z.strictObject({
    id: z.string().min(1).max(64).describe('Names the recording, e.g. `2026-10-27T21-03-12-live`'),
    kind: RecordingKind,
    title: z.string().max(200).optional().describe("The show's name, for a live show armed with one"),
    startedAt: _ZodDatetime,
    endedAt: _ZodDatetime.optional().describe('Absent while it is still being recorded'),
    bytes: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0)),
    recording: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe('Still being written. It cannot be deleted until it ends'),
    audioUrl: z
        .string()
        .min(1)
        .max(2000)
        .describe('Where a player can stream it from, signed for a while so an audio element needs no token. Relative to the API'),
});
export type Recording = z.infer<typeof Recording>;

export const RecordingInput = z.strictObject({});
export type RecordingInput = z.infer<typeof RecordingInput>;

/**
 * Every recording, newest first, and whether the station is recording at all.
 * generated from [RecordingList](../../../../data/contracts/stream/stream.archive.types.ck)
 */
export const RecordingList = z.strictObject({
    mode: z.enum(['off', 'live', 'all']).describe('What the archive is set to keep'),
    retentionDays: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0))
        .describe('How long a finished recording is kept. Zero keeps all of them'),
    recordings: z.array(Recording),
});
export type RecordingList = z.infer<typeof RecordingList>;

export const RecordingListInput = z.strictObject({
    recordings: z.array(RecordingInput),
});
export type RecordingListInput = z.infer<typeof RecordingListInput>;
