import { z } from 'zod';

/**
 * A host who sits in on a slot on some nights, saying whose show it usually is
 * generated from [SlotGuestHost](../../../../data/contracts/schedule/schedule.types.ck#L35)
 */
export const SlotGuestHost = z.strictObject({
    personaId: z.string().min(1).max(100).describe('Who sits in. A host; a caller or a guest who drops by can never present a show'),
    days: z
        .array(z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0).max(6)))
        .optional()
        .describe('The nights they present, by the weekday the night begins on, Sunday 0. Send this or `everyN`, not both'),
    everyN: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(2).max(366))
        .optional()
        .describe("Or at random: about one of this slot's nights in this many, on nights nobody can predict. 7 is about one in seven"),
    cooldownDays: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0).max(366))
        .optional()
        .describe(
            'With `everyN`, the fewest days between two of their nights. Absent is half of `everyN`, so even one in seven never lands two nights running',
        ),
});
export type SlotGuestHost = z.infer<typeof SlotGuestHost>;

/**
 * A window of the station's day to draw
 * generated from [ScheduleTimetableQuery](../../../../data/contracts/schedule/schedule.types.ck#L47)
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
 * generated from [ScheduleOccurrence](../../../../data/contracts/schedule/schedule.types.ck#L60)
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
    sourceStationPlaylistId: z
        .uuid()
        .optional()
        .describe(
            "A playlist the station owns to play instead, read from the station's own library when the block starts rather than from a provider. An ALTERNATIVE to the playlist pair, which it wins over, and to `sourceChartId`, which wins over it",
        ),
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
    mood: z
        .enum(['love', 'happiness', 'comfort', 'sadness', 'loneliness', 'anger', 'fear'])
        .optional()
        .describe(
            'The mood this stretch of the day leans into. Records a model has judged to be in it are a little more likely to be picked; nothing is ever kept off the air for it. Absent is no lean',
        ),
    callins: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .optional()
        .describe(
            'Whether somebody phones in during this stretch of the day. Absent is no calls, exactly as it is when an operator puts a broadcast on air by hand; a `setlist` or a `feature` takes no calls whatever this says',
        ),
    mixInSimilar: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .optional()
        .describe(
            "Whether records that sound like this slot's playlist are mixed in among its records, one every `rotation.mixInEvery` records. Absent leaves the station's own setting standing, exactly as it does when an operator airs a playlist by hand; a slot with no playlist, or a `setlist` or a `feature`, never mixes whatever this says",
        ),
    startsOn: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe(
            'The first date this slot runs on, as `YYYY-MM-DD`, which makes it a SPECIAL rather than a weekly slot. On its dates a special takes over from the weekly schedule for its hours, and the weekly show resumes when it ends. Sent with `endsOn` or not at all',
        ),
    endsOn: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe('The last date it runs on, inclusive. `days` still applies in between, so the Fridays in December are a range and a mask'),
    guestHosts: z
        .array(SlotGuestHost)
        .max(8)
        .optional()
        .describe(
            "Hosts who sit in for this slot's own host on some nights, in precedence order: the first whose night it is takes it. A guest on fixed nights wins over one at random. Absent or empty is a slot its own host presents every time",
        ),
    yearly: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .optional()
        .describe(
            'Whether the special repeats every year on the same month and day, such as Halloween. Absent is a one-off. A yearly range may run past New Year and must be shorter than a year',
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
    sourceStationPlaylistId: z
        .uuid()
        .optional()
        .describe(
            "A playlist the station owns to play instead, read from the station's own library when the block starts rather than from a provider. An ALTERNATIVE to the playlist pair, which it wins over, and to `sourceChartId`, which wins over it",
        ),
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
    mood: z
        .enum(['love', 'happiness', 'comfort', 'sadness', 'loneliness', 'anger', 'fear'])
        .optional()
        .describe(
            'The mood this stretch of the day leans into. Records a model has judged to be in it are a little more likely to be picked; nothing is ever kept off the air for it. Absent is no lean',
        ),
    callins: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .optional()
        .describe(
            'Whether somebody phones in during this stretch of the day. Absent is no calls, exactly as it is when an operator puts a broadcast on air by hand; a `setlist` or a `feature` takes no calls whatever this says',
        ),
    mixInSimilar: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .optional()
        .describe(
            "Whether records that sound like this slot's playlist are mixed in among its records, one every `rotation.mixInEvery` records. Absent leaves the station's own setting standing, exactly as it does when an operator airs a playlist by hand; a slot with no playlist, or a `setlist` or a `feature`, never mixes whatever this says",
        ),
    startsOn: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe(
            'The first date this slot runs on, as `YYYY-MM-DD`, which makes it a SPECIAL rather than a weekly slot. On its dates a special takes over from the weekly schedule for its hours, and the weekly show resumes when it ends. Sent with `endsOn` or not at all',
        ),
    endsOn: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe('The last date it runs on, inclusive. `days` still applies in between, so the Fridays in December are a range and a mask'),
    guestHosts: z
        .array(SlotGuestHost)
        .max(8)
        .optional()
        .describe(
            "Hosts who sit in for this slot's own host on some nights, in precedence order: the first whose night it is takes it. A guest on fixed nights wins over one at random. Absent or empty is a slot its own host presents every time",
        ),
    yearly: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .optional()
        .describe(
            'Whether the special repeats every year on the same month and day, such as Halloween. Absent is a one-off. A yearly range may run past New Year and must be shorter than a year',
        ),
    mode: z.enum(['rotation', 'setlist', 'feature']),
    onEnd: z.enum(['extend', 'repeat', 'stop']),
});
export type ScheduleSlotInput = z.infer<typeof ScheduleSlotInput>;

/**
 * The station's day as blocks, ready to draw
 * generated from [ScheduleTimetable](../../../../data/contracts/schedule/schedule.types.ck#L53)
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
 * generated from [ScheduleNow](../../../../data/contracts/schedule/schedule.types.ck#L68)
 */
export const ScheduleNow = z.strictObject({
    now: z
        .string()
        .min(19)
        .max(19)
        .describe(
            "What time it is on the station's own clock, in the same zone-naive `YYYY-MM-DD HH:mm:ss` shape as a block's ends. It is here so a caller can say how much of the block is left without knowing the station's timezone: subtracting two readings taken in one frame is arithmetic, deriving one is not",
        ),
    timezone: z
        .string()
        .min(1)
        .max(100)
        .optional()
        .describe(
            "The IANA zone the station reads its clock in: `station.timezone`, or the machine's own when that is empty. Optional because a station from before it existed does not send it. For a console showing the station's time beside an operator's own when the two differ, which a zone-naive reading cannot tell it",
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

/**
 * generated from [ScheduleSlotList](../../../../data/contracts/schedule/schedule.types.ck#L42)
 */
export const ScheduleSlotList = z.strictObject({
    slots: z.array(ScheduleSlot),
});
export type ScheduleSlotList = z.infer<typeof ScheduleSlotList>;

export const ScheduleSlotListInput = z.strictObject({
    slots: z.array(ScheduleSlotInput),
});
export type ScheduleSlotListInput = z.infer<typeof ScheduleSlotListInput>;
