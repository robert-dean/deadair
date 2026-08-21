import { z } from 'zod';
import { Rating } from '../../catalog/types/catalog.types.js';

/**
 * What kind of programming the station is running, which decides the rules it runs under
 * generated from [StationMode](file://./../../../../data/contracts/director/director.types.ck#L8)
 */
export const StationMode = z.enum(['rotation', 'setlist', 'feature']);
export type StationMode = z.infer<typeof StationMode>;

/**
 * What the mount lease is renewed against: `audience` airs only while somebody is listening, `always` airs whenever there is a programme
 * generated from [AirMode](file://./../../../../data/contracts/director/director.types.ck#L11)
 */
export const AirMode = z.enum(['audience', 'always']);
export type AirMode = z.infer<typeof AirMode>;

/**
 * What the station does when the running order runs out
 * generated from [StationOnEnd](file://./../../../../data/contracts/director/director.types.ck#L27)
 */
export const StationOnEnd = z.enum(['extend', 'repeat', 'stop']);
export type StationOnEnd = z.infer<typeof StationOnEnd>;

/**
 * Where an item of the running order has got to. `handed` is a promise and `airing` is a fact, which is the distinction everything here is built around. The three terminal states that are not `played` are three different facts on a page that has to say why the station is silent: `skipped` is the station passing over an item it reached, `removed` is an operator taking one out before its turn, and `unavailable` is a record the station could not obtain the audio for — the only one of the three an operator can act on, since it names a copy rather than a decision
 * generated from [StationItemState](file://./../../../../data/contracts/director/director.types.ck#L30)
 */
export const StationItemState = z.enum(['planned', 'handed', 'airing', 'played', 'skipped', 'unavailable', 'removed']);
export type StationItemState = z.infer<typeof StationItemState>;

/**
 * Change who is presenting the broadcast that is on air
 * generated from [SetStationHostInput](file://./../../../../data/contracts/director/director.types.ck#L81)
 */
export const SetStationHostInput = z.strictObject({
    personaId: z
        .string()
        .min(1)
        .max(100)
        .optional()
        .describe(
            'Who hosts it from here on. Absent hands it back to whichever persona the station has on air, which is what a broadcast that never named one already does',
        ),
});
export type SetStationHostInput = z.infer<typeof SetStationHostInput>;

/**
 * Put something the station says into the running order
 * generated from [AddStationSegmentInput](file://./../../../../data/contracts/director/director.types.ck#L85)
 */
export const AddStationSegmentInput = z.strictObject({
    segmentId: z.string().min(1).max(100),
    atIndex: z.coerce
        .number()
        .int()
        .min(0)
        .optional()
        .describe('Where to put it. Absent puts it at the end. A position already handed to the player is refused'),
    overAtMs: z.coerce
        .number()
        .int()
        .min(0)
        .max(600000)
        .optional()
        .describe(
            'Play it OVER the record that follows, this far into it, rather than in the gap before it. Absent plays it between two records, which is the simpler path',
        ),
});
export type AddStationSegmentInput = z.infer<typeof AddStationSegmentInput>;

/**
 * Move an item within the running order
 * generated from [MoveStationItemInput](file://./../../../../data/contracts/director/director.types.ck#L91)
 */
export const MoveStationItemInput = z.strictObject({
    toIndex: z.coerce.number().int().min(0),
});
export type MoveStationItemInput = z.infer<typeof MoveStationItemInput>;

/**
 * Add tracks to the running order now, rather than waiting for it to run short
 * generated from [ExtendStationInput](file://./../../../../data/contracts/director/director.types.ck#L95)
 */
export const ExtendStationInput = z.strictObject({
    count: z.coerce.number().int().min(1).max(100).optional(),
});
export type ExtendStationInput = z.infer<typeof ExtendStationInput>;

/**
 * Throw away everything the player is not already holding and programme it again. Unlike a shuffle, the records themselves change; unlike putting the station on air, the broadcast continues
 * generated from [ReplanStationInput](file://./../../../../data/contracts/director/director.types.ck#L99)
 */
export const ReplanStationInput = z.strictObject({
    count: z.coerce.number().int().min(1).max(100).optional().describe('How many records to programme. Absent is roughly an hour'),
    brief: z
        .string()
        .max(500)
        .optional()
        .describe(
            "What the station should play from here on, in your own words. Absent keeps whatever this broadcast was already asked for; an empty string CLEARS it, which hands the programming back to the station's ordinary rotation. It steers every later refill too, not just this one batch",
        ),
});
export type ReplanStationInput = z.infer<typeof ReplanStationInput>;

/**
 * What the station is airing, and whether it is driving at all
 * generated from [StationAir](file://./../../../../data/contracts/director/director.types.ck#L13)
 */
export const StationAir = z.strictObject({
    active: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe('False means the station was stood down. What it was playing is remembered so the console can still say what it was'),
    airMode: AirMode.describe(
        'What puts the station on air. In `audience` mode a station that is active with a full running order is still silent while nobody is connected, which is the intended state and not a fault',
    ),
    name: z.string().max(200).optional().describe('What is on. Absent before the station has ever been given anything to play'),
    source: z.string().max(50).optional().describe('Who built what is on: `import` or `director`'),
    remaining: z.coerce.number().int().min(0).describe('Items left before the running order runs out and `onEnd` decides what happens'),
    slotId: z
        .string()
        .max(100)
        .optional()
        .describe('Which slot of the schedule this broadcast belongs to. Absent means nothing scheduled it, which is every station with no schedule'),
});
export type StationAir = z.infer<typeof StationAir>;

/**
 * Change how the station decides to be on air
 * generated from [SetStationAirInput](file://./../../../../data/contracts/director/director.types.ck#L22)
 */
export const SetStationAirInput = z.strictObject({
    airMode: AirMode,
});
export type SetStationAirInput = z.infer<typeof SetStationAirInput>;

/**
 * Put the station on air, building its running order from the top
 * generated from [PutOnAirInput](file://./../../../../data/contracts/director/director.types.ck#L69)
 */
export const PutOnAirInput = z.strictObject({
    pluginId: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe('The plugin whose playlist to build from. Absent starts empty and lets the station generate its own programming'),
    playlistId: z
        .string()
        .min(1)
        .max(400)
        .optional()
        .describe(
            'Required alongside `pluginId`. The playlist is READ at this moment rather than copied, so it is never edited by having been aired',
        ),
    name: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe(
            'What to call this broadcast. Absent names it after the plugin, since only the surface that listed the playlist knows its own name for it',
        ),
    brief: z
        .string()
        .max(500)
        .optional()
        .describe(
            'What the station should play, in your own words: "heavy metal hits". It steers every refill for as long as this broadcast runs, not just the first batch, and it needs a model to programme with. Absent programmes the station the way its own rules do',
        ),
    personaId: z
        .string()
        .min(1)
        .max(100)
        .optional()
        .describe(
            'Who is hosting this broadcast. It rides the running order for as long as the broadcast does, so the presenter cannot drift back mid-show. Absent uses whichever persona the station has on air',
        ),
    eraFrom: z.coerce
        .number()
        .int()
        .min(1900)
        .max(2100)
        .optional()
        .describe(
            'The earliest release year this broadcast plays. Absent means no lower bound, and a record whose year the catalog does not know is played whatever the period',
        ),
    eraTo: z.coerce
        .number()
        .int()
        .min(1900)
        .max(2100)
        .optional()
        .describe('The latest release year, on the same terms. Set with `eraFrom` for a decade; either may stand alone'),
    mode: StationMode.optional(),
    onEnd: StationOnEnd.optional(),
});
export type PutOnAirInput = z.infer<typeof PutOnAirInput>;

/**
 * One item of the live running order, and where it has got to
 * generated from [StationOrderItem](file://./../../../../data/contracts/director/director.types.ck#L32)
 */
export const StationOrderItem = z.strictObject({
    id: z.string().min(1).max(100).describe('What an edit names, what rides through the player, and what comes back on its readings'),
    kind: z.enum(['track', 'segment']).describe('Whether this is a record or something the station says: an ident, a stinger, a talk break'),
    state: StationItemState,
    title: z.string().min(1).max(400).describe("The record's title, or the segment's label. What the mount is labelled with while it airs"),
    artists: z.array(z.string().min(1).max(200)).describe('Empty for a segment, which has no artist'),
    durationMs: z.coerce.number().int().min(0).optional(),
    pluginId: z.string().min(1).max(200).optional().describe('Absent on a segment: the station serves its own audio'),
    externalId: z.string().min(1).max(400).optional().describe('Absent on a segment'),
    album: z.string().max(400).optional(),
    artworkUrl: z.string().max(2000).optional(),
    year: z.coerce.number().int().min(0).optional(),
    trackId: z.string().max(100).optional().describe('The canonical catalog track, when this is one the catalog holds'),
    artistId: z
        .string()
        .max(100)
        .optional()
        .describe(
            'The canonical artist behind that track, so a console can reach their page from the running order. Absent on a segment, and on a record the catalog has never seen',
        ),
    albumId: z
        .string()
        .max(100)
        .optional()
        .describe(
            'The release that track was ingested inside. Absent for the two reasons above and for a third: a single ingested outside any release has none',
        ),
    rating: Rating.optional().describe(
        'What the station thinks of this record, read as the order is drawn rather than stored on it. Absent on a segment, and on a record the catalog has never seen',
    ),
    segmentId: z.string().min(1).max(100).optional().describe('Which segment this plays. Present only on a segment'),
    segmentState: z.enum(['planned', 'writing', 'written', 'rendering', 'ready', 'failed', 'gone']).optional(),
    playable: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .optional()
        .describe('Whether the station can actually air this segment. One that cannot is SKIPPED when it comes round, rather than held open'),
    segmentError: z.string().max(2000).optional().describe('Why this segment will not air, in a sentence. Present only on a failed one'),
    segmentWriter: z
        .string()
        .max(200)
        .optional()
        .describe("What decided the words: the station's own templates, or the model that wrote them. Absent on a recording somebody made"),
    overAtMs: z.coerce
        .number()
        .int()
        .min(0)
        .optional()
        .describe(
            'Heard OVER the record that follows, this far into it, with the music ducked under it. Such an item is never handed to the player in its own right',
        ),
});
export type StationOrderItem = z.infer<typeof StationOrderItem>;

/**
 * The station's live running order: what is airing, item by item
 * generated from [StationOrder](file://./../../../../data/contracts/director/director.types.ck#L56)
 */
export const StationOrder = z.strictObject({
    name: z.string().max(200).describe('What is on, for a console to draw. A label for this broadcast rather than the name of a stored object'),
    brief: z
        .string()
        .max(500)
        .optional()
        .describe(
            'What the operator asked the station to play, in their own words. It keeps steering every refill until the station is put on air again, so a console should show it rather than only accept it',
        ),
    personaId: z
        .string()
        .max(100)
        .optional()
        .describe('Who is hosting this broadcast, when it named somebody. Absent means whichever persona the station has on air'),
    personaLabel: z
        .string()
        .max(200)
        .optional()
        .describe('What that host is called, resolved as the order is read so a console need not fetch the persona list to draw a name'),
    mode: StationMode,
    onEnd: StationOnEnd,
    source: z.string().min(1).max(50).describe('Who built it: `import` or `director`'),
    sourcePluginId: z.string().max(200).optional().describe('Where more material is pulled from, when it came from a playlist'),
    sourcePlaylistId: z.string().max(400).optional(),
    items: z.array(StationOrderItem),
});
export type StationOrder = z.infer<typeof StationOrder>;
