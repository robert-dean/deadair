import { z } from 'zod';

/**
 * One act on a festival's bill
 * generated from [FestivalAct](../../../../data/contracts/schedule/festivals.types.ck)
 */
export const FestivalAct = z.strictObject({
    artist: z
        .string()
        .min(1)
        .max(200)
        .describe('As the station credits them, which is the name said on air and the name the station looks their records up by'),
    day: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe("The day they play, as `YYYY-MM-DD`, when the bill says. Inside the festival's dates"),
    headliner: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .optional()
        .describe('Whether they top the bill. Absent is no'),
});
export type FestivalAct = z.infer<typeof FestivalAct>;

/**
 * A festival as a ticket service lists it, for an operator to check and then add. Nothing here is said on air until it is saved as a festival
 * generated from [FestivalListing](../../../../data/contracts/schedule/festivals.types.ck)
 */
export const FestivalListing = z.strictObject({
    pluginId: z.string().describe('The plugin that listed it, to send back as `sourcePluginId`'),
    eventId: z.string().describe('Its own id for the listing, to send back as `sourceEventId`'),
    name: z.string(),
    startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    place: z.string().optional().describe('The venue and the town, as the service gives them'),
    url: z.string().optional(),
    acts: z.array(z.string()).describe('Who the service lists as performing, in its order'),
});
export type FestivalListing = z.infer<typeof FestivalListing>;

/**
 * A music festival the station can build a show around: its dates, where it is, and who is on the bill. What a presenter says about it is read from here, so its dates are the ones an operator typed or checked
 * generated from [Festival](../../../../data/contracts/schedule/festivals.types.ck)
 */
export const Festival = z.strictObject({
    id: z.uuid(),
    name: z.string().min(1).max(120).describe('Said on air as written: `Shaky Knees`, `the Newport Folk Festival`'),
    startsOn: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .describe("The first day, as `YYYY-MM-DD` on the festival's own calendar"),
    endsOn: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .describe('The last day, inclusive. The same as `startsOn` for a one-day festival'),
    place: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe('Where it is, as a presenter would say it: `Piedmont Park, Atlanta`. Absent says nothing about where'),
    url: z.string().min(1).max(2000).optional().describe("The festival's own page. Kept as where the facts came from, and never read out"),
    acts: z.array(FestivalAct).max(300).describe('Who is on the bill, in the order they should be listed. A name given twice is kept once'),
    state: z
        .enum(['upcoming', 'on', 'over'])
        .describe(
            "Where the festival stands on the station's calendar today: still to come, on now, or finished. A finished festival is never talked about",
        ),
    sourcePluginId: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe(
            'The plugin a festival was imported from, from `GET /festivals/lookup`. Absent for one an operator typed. Kept as it was when a festival is changed, whatever is sent',
        ),
});
export type Festival = z.infer<typeof Festival>;

export const FestivalInput = z.strictObject({
    name: z.string().min(1).max(120).describe('Said on air as written: `Shaky Knees`, `the Newport Folk Festival`'),
    startsOn: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .describe("The first day, as `YYYY-MM-DD` on the festival's own calendar"),
    endsOn: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .describe('The last day, inclusive. The same as `startsOn` for a one-day festival'),
    place: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe('Where it is, as a presenter would say it: `Piedmont Park, Atlanta`. Absent says nothing about where'),
    url: z.string().min(1).max(2000).optional().describe("The festival's own page. Kept as where the facts came from, and never read out"),
    acts: z.array(FestivalAct).max(300).describe('Who is on the bill, in the order they should be listed. A name given twice is kept once'),
    sourcePluginId: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe(
            'The plugin a festival was imported from, from `GET /festivals/lookup`. Absent for one an operator typed. Kept as it was when a festival is changed, whatever is sent',
        ),
    sourceEventId: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe("That plugin's own id for the listing, sent with `sourcePluginId` when adding an imported festival"),
});
export type FestivalInput = z.infer<typeof FestivalInput>;

/**
 * What looking a festival up found, soonest first
 * generated from [FestivalLookup](../../../../data/contracts/schedule/festivals.types.ck)
 */
export const FestivalLookup = z.strictObject({
    listings: z.array(FestivalListing),
    unanswered: z
        .array(z.string())
        .optional()
        .describe('The plugins that were asked and could not answer, so an empty list is not read as nothing being on'),
});
export type FestivalLookup = z.infer<typeof FestivalLookup>;

/**
 * Every festival on the station, soonest first
 * generated from [FestivalList](../../../../data/contracts/schedule/festivals.types.ck)
 */
export const FestivalList = z.strictObject({
    festivals: z.array(Festival),
});
export type FestivalList = z.infer<typeof FestivalList>;

export const FestivalListInput = z.strictObject({
    festivals: z.array(FestivalInput),
});
export type FestivalListInput = z.infer<typeof FestivalListInput>;
