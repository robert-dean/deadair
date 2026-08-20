import { z } from 'zod';

/**
 * One rule on the station's format clock: a sort of break, and when it happens
 * generated from [ClockBand](file://./../../../../data/contracts/director/clock.types.ck#L8)
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
    hour: z.coerce
        .number()
        .int()
        .min(0)
        .max(23)
        .optional()
        .describe('For a `clock` band: the hour it happens at. Absent means every hour, which is the common case'),
    minute: z.coerce.number().int().min(0).max(59).optional().describe('For a `clock` band: minutes past the hour'),
    everyMs: z.coerce.number().int().min(60000).optional().describe('For an `interval` band: how far apart, in milliseconds'),
    position: z.coerce
        .number()
        .int()
        .min(0)
        .describe("Where this sits in the operator's own order, which is what settles a boundary two rules both want"),
    enabled: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()).describe('A rule turned off without being lost'),
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
    hour: z.coerce
        .number()
        .int()
        .min(0)
        .max(23)
        .optional()
        .describe('For a `clock` band: the hour it happens at. Absent means every hour, which is the common case'),
    minute: z.coerce.number().int().min(0).max(59).optional().describe('For a `clock` band: minutes past the hour'),
    everyMs: z.coerce.number().int().min(60000).optional().describe('For an `interval` band: how far apart, in milliseconds'),
    position: z.coerce
        .number()
        .int()
        .min(0)
        .describe("Where this sits in the operator's own order, which is what settles a boundary two rules both want"),
    enabled: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean()).describe('A rule turned off without being lost'),
});
export type ClockBandInput = z.infer<typeof ClockBandInput>;

/**
 * generated from [ClockBandList](file://./../../../../data/contracts/director/clock.types.ck#L19)
 */
export const ClockBandList = z.strictObject({
    bands: z.array(ClockBand),
});
export type ClockBandList = z.infer<typeof ClockBandList>;

export const ClockBandListInput = z.strictObject({
    bands: z.array(ClockBandInput),
});
export type ClockBandListInput = z.infer<typeof ClockBandListInput>;
