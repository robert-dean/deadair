import { z } from 'zod';

/**
 * One stretch of the station's day: from this time, on these days, the station plays this
 * generated from [ScheduleSlot](../../../../data/contracts/schedule/schedule.types.ck#L8)
 */
export const ScheduleSlot = z.strictObject({
    id: z.string().min(1).max(100),
    label: z.string().max(200).describe("What the operator calls this stretch of the day. Becomes the broadcast's name"),
    startsAtMinutes: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0).max(1439))
        .describe("When it starts, as minutes past midnight on the station's clock"),
    endsAtMinutes: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0).max(1439))
        .describe(
            'When it stops, in the same terms. Before the start means the block runs past midnight, which is ordinary for a late show; equal to it means a full twenty-four hours',
        ),
    days: z
        .array(z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0).max(6)))
        .optional()
        .describe('The weekdays it runs on, Sunday 0. Absent or empty means every day'),
    sourcePluginId: z
        .string()
        .max(200)
        .optional()
        .describe('The plugin the records come from. Absent, with no playlist, is a slot the station fills itself'),
    sourcePlaylistId: z.string().max(500).optional(),
    sourceChartId: z
        .string()
        .max(400)
        .optional()
        .describe(
            'A published chart to play instead, as `pluginId:chartId`. An ALTERNATIVE to the playlist pair rather than a companion, and it wins if both are sent: a playlist names copies the station can already fetch and a chart names records it has to look up',
        ),
    sourceChartOrder: z
        .enum(['countdown', 'ranked', 'unordered'])
        .optional()
        .describe('Which way round that chart is played. Absent is `countdown`, which ends on number one. Ignored without `sourceChartId`'),
    personaId: z.string().max(100).optional().describe("Who hosts this stretch of the day. Absent means the station's own active persona"),
    brief: z
        .string()
        .max(500)
        .optional()
        .describe(
            "What this stretch of the day is asked to play, in the operator's own words. The same ceiling `PutOnAirInput.brief` has, because a changeover builds one of those from this and the two boxes are one field set on the console",
        ),
    eraFrom: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(1900).max(2100))
        .optional()
        .describe(
            'The earliest release year this stretch of the day plays. Absent means no lower bound, and a record whose year the catalog does not know is played whatever the period',
        ),
    eraTo: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(1900).max(2100))
        .optional()
        .describe('The latest release year, on the same terms. Set with `eraFrom` for a decade; either may stand alone'),
    callins: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .optional()
        .describe(
            "Whether somebody phones in during this stretch of the day. Absent leaves the station's own setting standing, exactly as it does when an operator briefs a broadcast by hand; a `setlist` or a `feature` takes no calls whatever this says",
        ),
    mode: z.enum(['rotation', 'setlist', 'feature']),
    onEnd: z.enum(['extend', 'repeat', 'stop']),
});
export type ScheduleSlot = z.infer<typeof ScheduleSlot>;

export const ScheduleSlotInput = z.strictObject({
    label: z.string().max(200).describe("What the operator calls this stretch of the day. Becomes the broadcast's name"),
    startsAtMinutes: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0).max(1439))
        .describe("When it starts, as minutes past midnight on the station's clock"),
    endsAtMinutes: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0).max(1439))
        .describe(
            'When it stops, in the same terms. Before the start means the block runs past midnight, which is ordinary for a late show; equal to it means a full twenty-four hours',
        ),
    days: z
        .array(z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0).max(6)))
        .optional()
        .describe('The weekdays it runs on, Sunday 0. Absent or empty means every day'),
    sourcePluginId: z
        .string()
        .max(200)
        .optional()
        .describe('The plugin the records come from. Absent, with no playlist, is a slot the station fills itself'),
    sourcePlaylistId: z.string().max(500).optional(),
    sourceChartId: z
        .string()
        .max(400)
        .optional()
        .describe(
            'A published chart to play instead, as `pluginId:chartId`. An ALTERNATIVE to the playlist pair rather than a companion, and it wins if both are sent: a playlist names copies the station can already fetch and a chart names records it has to look up',
        ),
    sourceChartOrder: z
        .enum(['countdown', 'ranked', 'unordered'])
        .optional()
        .describe('Which way round that chart is played. Absent is `countdown`, which ends on number one. Ignored without `sourceChartId`'),
    personaId: z.string().max(100).optional().describe("Who hosts this stretch of the day. Absent means the station's own active persona"),
    brief: z
        .string()
        .max(500)
        .optional()
        .describe(
            "What this stretch of the day is asked to play, in the operator's own words. The same ceiling `PutOnAirInput.brief` has, because a changeover builds one of those from this and the two boxes are one field set on the console",
        ),
    eraFrom: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(1900).max(2100))
        .optional()
        .describe(
            'The earliest release year this stretch of the day plays. Absent means no lower bound, and a record whose year the catalog does not know is played whatever the period',
        ),
    eraTo: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(1900).max(2100))
        .optional()
        .describe('The latest release year, on the same terms. Set with `eraFrom` for a decade; either may stand alone'),
    callins: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .optional()
        .describe(
            "Whether somebody phones in during this stretch of the day. Absent leaves the station's own setting standing, exactly as it does when an operator briefs a broadcast by hand; a `setlist` or a `feature` takes no calls whatever this says",
        ),
    mode: z.enum(['rotation', 'setlist', 'feature']),
    onEnd: z.enum(['extend', 'repeat', 'stop']),
});
export type ScheduleSlotInput = z.infer<typeof ScheduleSlotInput>;

/**
 * A window of the station's day to draw
 * generated from [ScheduleTimetableQuery](../../../../data/contracts/schedule/schedule.types.ck#L32)
 */
export const ScheduleTimetableQuery = z.strictObject({
    from: z
        .string()
        .min(10)
        .max(10)
        .optional()
        .describe(
            "The first day to draw, as `YYYY-MM-DD` on the station's own calendar. Absent means the station's today, which is the only way a caller that does not know the station's timezone can anchor",
        ),
    days: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(1).max(31))
        .optional()
        .describe('How many days from `from`. Defaults to a week'),
});
export type ScheduleTimetableQuery = z.infer<typeof ScheduleTimetableQuery>;

/**
 * One block: this slot, on this day, between these two times
 * generated from [ScheduleOccurrence](../../../../data/contracts/schedule/schedule.types.ck#L45)
 */
export const ScheduleOccurrence = z.strictObject({
    slotId: z.string().min(1).max(100),
    label: z.string().max(200),
    start: z
        .string()
        .min(19)
        .max(19)
        .describe(
            "`YYYY-MM-DD HH:mm:ss` on the station's own clock, deliberately carrying no timezone offset: it is a reading rather than a moment, so it draws as written wherever the console is running",
        ),
    end: z.string().min(19).max(19).describe('The same, exclusive. Every block stays inside one day, so a slot running past midnight arrives as two'),
});
export type ScheduleOccurrence = z.infer<typeof ScheduleOccurrence>;

/**
 * generated from [ScheduleSlotList](../../../../data/contracts/schedule/schedule.types.ck#L27)
 */
export const ScheduleSlotList = z.strictObject({
    slots: z.array(ScheduleSlot),
});
export type ScheduleSlotList = z.infer<typeof ScheduleSlotList>;

export const ScheduleSlotListInput = z.strictObject({
    slots: z.array(ScheduleSlotInput),
});
export type ScheduleSlotListInput = z.infer<typeof ScheduleSlotListInput>;

/**
 * The station's day as blocks, ready to draw
 * generated from [ScheduleTimetable](../../../../data/contracts/schedule/schedule.types.ck#L38)
 */
export const ScheduleTimetable = z.strictObject({
    from: z
        .string()
        .min(10)
        .max(10)
        .describe(
            "The range actually drawn, echoed so a caller steps forward and back by adding days to a string rather than by knowing the station's timezone",
        ),
    days: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(1).max(31)),
    occurrences: z.array(ScheduleOccurrence),
});
export type ScheduleTimetable = z.infer<typeof ScheduleTimetable>;

/**
 * Which slot the clock says should be on right now, and what follows it
 * generated from [ScheduleNow](../../../../data/contracts/schedule/schedule.types.ck#L53)
 */
export const ScheduleNow = z.strictObject({
    now: z
        .string()
        .min(19)
        .max(19)
        .describe(
            "What time it is on the station's own clock, in the same zone-naive `YYYY-MM-DD HH:mm:ss` shape as a block's ends. It is here so a caller can say how much of the block is left without knowing the station's timezone: subtracting two readings taken in one frame is arithmetic, deriving one is not",
        ),
    slotId: z.string().max(100).optional().describe('The slot in force at this instant. Absent means the station has no schedule'),
    airingSlotId: z
        .string()
        .max(100)
        .optional()
        .describe(
            "The slot the running order actually belongs to. Different from the one above while an operator's own choice holds, which it does until the next slot begins",
        ),
    upcoming: z
        .array(ScheduleOccurrence)
        .describe(
            'The block on now, if there is one, and the few that follow it, earliest first. Empty for a station with nothing scheduled from here on. A gap is simply absent, exactly as it is on the timetable: what plays there is the sustaining source rather than a block',
        ),
});
export type ScheduleNow = z.infer<typeof ScheduleNow>;
