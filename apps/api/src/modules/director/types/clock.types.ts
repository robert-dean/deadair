import { z } from 'zod';
import { PackImportPlan } from '../../topics/types/topics.types.js';

/**
 * One rule on the station's format clock: a sort of break, and when it happens
 * generated from [ClockBand](../../../../data/contracts/director/clock.types.ck)
 */
export const ClockBand = z.strictObject({
    id: z.string().min(1).max(100),
    kind: z
        .string()
        .min(1)
        .max(100)
        .describe(
            'Which sort of break this slot wants, as `segments.kind` spells it. Free text: a station that wants sponsor spots writes `sponsor` and drops the recordings in',
        ),
    at: z
        .enum(['clock', 'interval'])
        .describe("`clock` is a time of day and `interval` is a spacing rule for a kind the station's own interval does not cover"),
    hour: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0).max(23))
        .optional()
        .describe('For a `clock` band: the hour it happens at. Absent means every hour, which is the common case'),
    minute: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0).max(59))
        .optional()
        .describe('For a `clock` band: minutes past the hour'),
    days: z
        .array(z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0).max(6)))
        .optional()
        .describe("For a `clock` band: the weekdays it happens on, Sunday 0, on the station's own clock. Absent or empty means every day"),
    everyMs: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(60000))
        .optional()
        .describe('For an `interval` band: how far apart, in milliseconds'),
    position: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0))
        .describe("Where this sits in the operator's own order, which is what settles a boundary two rules both want"),
    enabled: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()).describe('A rule turned off without being lost'),
    topicId: z
        .string()
        .min(1)
        .max(100)
        .optional()
        .describe(
            'What this band is about, as a subject of its own kind: a news category, later a weather location. Absent means it covers whatever it finds',
        ),
    topicLabel: z.string().min(1).max(200).optional().describe("That subject's name, so a list can be drawn without a second call"),
});
export type ClockBand = z.infer<typeof ClockBand>;

export const ClockBandInput = z.strictObject({
    kind: z
        .string()
        .min(1)
        .max(100)
        .describe(
            'Which sort of break this slot wants, as `segments.kind` spells it. Free text: a station that wants sponsor spots writes `sponsor` and drops the recordings in',
        ),
    at: z
        .enum(['clock', 'interval'])
        .describe("`clock` is a time of day and `interval` is a spacing rule for a kind the station's own interval does not cover"),
    hour: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0).max(23))
        .optional()
        .describe('For a `clock` band: the hour it happens at. Absent means every hour, which is the common case'),
    minute: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0).max(59))
        .optional()
        .describe('For a `clock` band: minutes past the hour'),
    days: z
        .array(z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0).max(6)))
        .optional()
        .describe("For a `clock` band: the weekdays it happens on, Sunday 0, on the station's own clock. Absent or empty means every day"),
    everyMs: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(60000))
        .optional()
        .describe('For an `interval` band: how far apart, in milliseconds'),
    position: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0))
        .describe("Where this sits in the operator's own order, which is what settles a boundary two rules both want"),
    enabled: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()).describe('A rule turned off without being lost'),
    topicId: z
        .string()
        .min(1)
        .max(100)
        .optional()
        .describe(
            'What this band is about, as a subject of its own kind: a news category, later a weather location. Absent means it covers whatever it finds',
        ),
});
export type ClockBandInput = z.infer<typeof ClockBandInput>;

/**
 * What a band in a file is about, carried whole so the file works on a station that has never heard of it
 * generated from [ClockPackTopic](../../../../data/contracts/director/clock.types.ck)
 */
export const ClockPackTopic = z.strictObject({
    key: z.string().min(1).max(100).describe("What identifies it within the band's kind"),
    label: z.string().min(1).max(200).describe('What a break calls it out loud'),
    config: z.record(z.string(), z.unknown()).optional().describe("This sort of break's own settings for this subject"),
});
export type ClockPackTopic = z.infer<typeof ClockPackTopic>;

/**
 * A format clock as one file, to hand to another station. Each entry is read as a `ClockPackRow` when it
 * is imported, so one a station cannot use is reported rather than refusing the file
 * generated from [ClockPack](../../../../data/contracts/director/clock.types.ck)
 */
export const ClockPack = z.strictObject({
    format: z.literal('deadair.clock').describe('Says the file is a clock file'),
    version: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(1))
        .describe("The version of the document's shape. This station reads version 1"),
    name: z.string().min(1).max(100).describe('What the file is, as whoever made it would describe it'),
    bands: z.array(z.record(z.string(), z.unknown())).max(500),
});
export type ClockPack = z.infer<typeof ClockPack>;

/**
 * generated from [ClockBandList](../../../../data/contracts/director/clock.types.ck)
 */
export const ClockBandList = z.strictObject({
    bands: z.array(ClockBand),
    producibleKinds: z
        .array(z.string().min(1).max(100))
        .describe(
            'Which sorts of break this station can actually make right now: one it can write and speak, one it has recordings of, or one it produces as an episode. A band naming anything else claims its boundary and then passes over it',
        ),
});
export type ClockBandList = z.infer<typeof ClockBandList>;

export const ClockBandListInput = z.strictObject({
    bands: z.array(ClockBandInput),
    producibleKinds: z
        .array(z.string().min(1).max(100))
        .describe(
            'Which sorts of break this station can actually make right now: one it can write and speak, one it has recordings of, or one it produces as an episode. A band naming anything else claims its boundary and then passes over it',
        ),
});
export type ClockBandListInput = z.infer<typeof ClockBandListInput>;

/**
 * One rule in a file. Nothing about the station it came from: no id, no place in its order, and no switch
 * generated from [ClockPackRow](../../../../data/contracts/director/clock.types.ck)
 */
export const ClockPackRow = z.strictObject({
    kind: z.string().min(1).max(100).describe('Which sort of break it wants, as `segments.kind` spells it'),
    at: z.enum(['clock', 'interval']),
    hour: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0).max(23)).optional(),
    minute: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0).max(59)).optional(),
    days: z.array(z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0).max(6))).optional(),
    everyMs: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(60000)).optional(),
    topic: ClockPackTopic.optional(),
});
export type ClockPackRow = z.infer<typeof ClockPackRow>;

/**
 * What an import did, and the clock as it now stands
 * generated from [ClockImportResult](../../../../data/contracts/director/clock.types.ck)
 */
export const ClockImportResult = z.strictObject({
    plan: PackImportPlan,
    list: ClockBandList,
});
export type ClockImportResult = z.infer<typeof ClockImportResult>;

export const ClockImportResultInput = z.strictObject({});
export type ClockImportResultInput = z.infer<typeof ClockImportResultInput>;
