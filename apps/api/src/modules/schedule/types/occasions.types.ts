import { z } from 'zod';

/**
 * What a date means where this station is: a name the presenters can say, and a mood to lean into on a
 * day the show on air names none. `ruleKind` says when it falls, and which of the fields beside it count
 * generated from [Occasion](../../../../data/contracts/schedule/occasions.types.ck)
 */
export const Occasion = z.strictObject({
    id: z.uuid(),
    words: z.string().min(1).max(80).describe('Said on air as written: `Halloween`, `the first day of Hanukkah`'),
    ruleKind: z
        .enum(['fixed', 'weekday', 'easter', 'calendar', 'dates'])
        .describe(
            '`fixed` is the same date every year, from `month` and `day`. `weekday` is the nth of a weekday in a month, from `month`, `ordinal` and `weekday`. `easter` is a number of days from Western Easter Sunday, from `offsetDays`. `calendar` is a date in the Hebrew or Islamic calendar, from `calendar`, `calendarMonth` and `day`. `dates` is the dates themselves, from `dates`, for what no rule can work out',
        ),
    month: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(1).max(12)).optional(),
    day: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(1).max(31))
        .optional()
        .describe("The day of the month, in the rule's own calendar"),
    ordinal: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(-1).max(5))
        .optional()
        .describe('Which of that weekday in the month: 1 to 5, or -1 for the last. The fourth Thursday of November is `4`'),
    weekday: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0).max(6))
        .optional()
        .describe('0 is Sunday'),
    offsetDays: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(-60).max(60))
        .optional()
        .describe('Days from Easter Sunday: 0 is the day itself and -2 is Good Friday'),
    calendar: z
        .enum(['hebrew', 'islamic-umalqura'])
        .optional()
        .describe('`islamic-umalqura` is calculated, so a community going by the sighted moon may keep the day a day either side of it'),
    calendarMonth: z.string().min(1).max(40).optional().describe('The month in that calendar, as `calendars` lists it'),
    dates: z.array(z.string().min(10).max(10)).max(200).optional().describe('As `YYYY-MM-DD`. These run out, so a list needs refreshing'),
    mood: z
        .enum(['love', 'happiness', 'comfort', 'sadness', 'loneliness', 'anger', 'fear'])
        .optional()
        .describe(
            'What this day leans into, when the show on air names no mood of its own. Records a model has judged to be in it are a little more likely to be picked, and nothing is ever kept off the air for it. Absent leans nothing',
        ),
    enabled: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe('Whether the station knows about it. Off, it is never said and never leans anything'),
    position: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int())
        .describe('Where it comes in the list. When two fall on one date the first wins'),
    nextDate: z
        .string()
        .min(10)
        .max(10)
        .optional()
        .describe(
            "When it next falls, as `YYYY-MM-DD` on the station's calendar, counting today. Absent when it does not fall again, as a list of dates that has run out",
        ),
});
export type Occasion = z.infer<typeof Occasion>;

export const OccasionInput = z.strictObject({
    words: z.string().min(1).max(80).describe('Said on air as written: `Halloween`, `the first day of Hanukkah`'),
    ruleKind: z
        .enum(['fixed', 'weekday', 'easter', 'calendar', 'dates'])
        .describe(
            '`fixed` is the same date every year, from `month` and `day`. `weekday` is the nth of a weekday in a month, from `month`, `ordinal` and `weekday`. `easter` is a number of days from Western Easter Sunday, from `offsetDays`. `calendar` is a date in the Hebrew or Islamic calendar, from `calendar`, `calendarMonth` and `day`. `dates` is the dates themselves, from `dates`, for what no rule can work out',
        ),
    month: z.preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(1).max(12)).optional(),
    day: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(1).max(31))
        .optional()
        .describe("The day of the month, in the rule's own calendar"),
    ordinal: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(-1).max(5))
        .optional()
        .describe('Which of that weekday in the month: 1 to 5, or -1 for the last. The fourth Thursday of November is `4`'),
    weekday: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(0).max(6))
        .optional()
        .describe('0 is Sunday'),
    offsetDays: z
        .preprocess(v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int().min(-60).max(60))
        .optional()
        .describe('Days from Easter Sunday: 0 is the day itself and -2 is Good Friday'),
    calendar: z
        .enum(['hebrew', 'islamic-umalqura'])
        .optional()
        .describe('`islamic-umalqura` is calculated, so a community going by the sighted moon may keep the day a day either side of it'),
    calendarMonth: z.string().min(1).max(40).optional().describe('The month in that calendar, as `calendars` lists it'),
    dates: z.array(z.string().min(10).max(10)).max(200).optional().describe('As `YYYY-MM-DD`. These run out, so a list needs refreshing'),
    mood: z
        .enum(['love', 'happiness', 'comfort', 'sadness', 'loneliness', 'anger', 'fear'])
        .optional()
        .describe(
            'What this day leans into, when the show on air names no mood of its own. Records a model has judged to be in it are a little more likely to be picked, and nothing is ever kept off the air for it. Absent leans nothing',
        ),
    enabled: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe('Whether the station knows about it. Off, it is never said and never leans anything'),
});
export type OccasionInput = z.infer<typeof OccasionInput>;

/**
 * The months of a calendar an occasion can be set in, in the order they come
 * generated from [OccasionCalendarMonths](../../../../data/contracts/schedule/occasions.types.ck)
 */
export const OccasionCalendarMonths = z.strictObject({
    calendar: z.enum(['hebrew', 'islamic-umalqura']),
    months: z.array(z.string()),
});
export type OccasionCalendarMonths = z.infer<typeof OccasionCalendarMonths>;

/**
 * A new order for the list
 * generated from [OccasionOrder](../../../../data/contracts/schedule/occasions.types.ck)
 */
export const OccasionOrder = z.strictObject({
    ids: z
        .array(z.uuid())
        .min(1)
        .max(500)
        .describe('Occasions in the order they should be matched. Any left out stay behind these, in their current order'),
});
export type OccasionOrder = z.infer<typeof OccasionOrder>;

/**
 * Every occasion on the station, in the order a date is matched against them
 * generated from [OccasionList](../../../../data/contracts/schedule/occasions.types.ck)
 */
export const OccasionList = z.strictObject({
    occasions: z.array(Occasion),
    calendars: z.array(OccasionCalendarMonths),
});
export type OccasionList = z.infer<typeof OccasionList>;

export const OccasionListInput = z.strictObject({
    occasions: z.array(OccasionInput),
    calendars: z.array(OccasionCalendarMonths),
});
export type OccasionListInput = z.infer<typeof OccasionListInput>;
