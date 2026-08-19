import { z } from 'zod';

/**
 * One stretch of the station's day: from this time, on these days, the station plays this
 * generated from [ScheduleSlot](file://./../../../../data/contracts/schedule/schedule.types.ck#L8)
 */
export const ScheduleSlot = z.strictObject({
    id: z.string().min(1).max(100),
    label: z.string().max(200).describe("What the operator calls this stretch of the day. Becomes the broadcast's name"),
    startsAtMinutes: z.coerce
        .number()
        .int()
        .min(0)
        .max(1439)
        .describe(
            "When it starts, as minutes past midnight on the station's clock. Only a start: a slot runs until the next one begins, and the last of the week wraps round",
        ),
    days: z.array(z.coerce.number().int().min(0).max(6)).optional().describe('The weekdays it runs on, Sunday 0. Absent or empty means every day'),
    sourcePluginId: z
        .string()
        .max(200)
        .optional()
        .describe('The plugin the records come from. Absent, with no playlist, is a slot the station fills itself'),
    sourcePlaylistId: z.string().max(500).optional(),
    personaId: z.string().max(100).optional().describe("Who hosts this stretch of the day. Absent means the station's own active persona"),
    brief: z.string().max(2000).optional().describe("What this stretch of the day is asked to play, in the operator's own words"),
    mode: z.enum(['rotation', 'setlist', 'feature']),
    onEnd: z.enum(['extend', 'repeat', 'stop']),
});
export type ScheduleSlot = z.infer<typeof ScheduleSlot>;

export const ScheduleSlotInput = z.strictObject({
    label: z.string().max(200).describe("What the operator calls this stretch of the day. Becomes the broadcast's name"),
    startsAtMinutes: z.coerce
        .number()
        .int()
        .min(0)
        .max(1439)
        .describe(
            "When it starts, as minutes past midnight on the station's clock. Only a start: a slot runs until the next one begins, and the last of the week wraps round",
        ),
    days: z.array(z.coerce.number().int().min(0).max(6)).optional().describe('The weekdays it runs on, Sunday 0. Absent or empty means every day'),
    sourcePluginId: z
        .string()
        .max(200)
        .optional()
        .describe('The plugin the records come from. Absent, with no playlist, is a slot the station fills itself'),
    sourcePlaylistId: z.string().max(500).optional(),
    personaId: z.string().max(100).optional().describe("Who hosts this stretch of the day. Absent means the station's own active persona"),
    brief: z.string().max(2000).optional().describe("What this stretch of the day is asked to play, in the operator's own words"),
    mode: z.enum(['rotation', 'setlist', 'feature']),
    onEnd: z.enum(['extend', 'repeat', 'stop']),
});
export type ScheduleSlotInput = z.infer<typeof ScheduleSlotInput>;

/**
 * generated from [ScheduleSlotList](file://./../../../../data/contracts/schedule/schedule.types.ck#L21)
 */
export const ScheduleSlotList = z.strictObject({
    slots: z.array(ScheduleSlot),
});
export type ScheduleSlotList = z.infer<typeof ScheduleSlotList>;

export const ScheduleSlotListInput = z.strictObject({
    slots: z.array(ScheduleSlotInput),
});
export type ScheduleSlotListInput = z.infer<typeof ScheduleSlotListInput>;
