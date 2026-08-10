import { z } from 'zod';

/**
 * What kind of programming a lineup is, which decides the rules it runs under
 * generated from [LineupMode](file://./../../../../data/contracts/director/director.types.ck#L8)
 */
export const LineupMode = z.enum(['rotation', 'setlist', 'feature']);
export type LineupMode = z.infer<typeof LineupMode>;

/**
 * generated from [LineupOnEnd](file://./../../../../data/contracts/director/director.types.ck#L10)
 */
export const LineupOnEnd = z.enum(['extend', 'repeat', 'resume', 'rotation', 'stop']);
export type LineupOnEnd = z.infer<typeof LineupOnEnd>;

/**
 * One line of a lineup, which is either a record or something the station says
 * generated from [LineupItem](file://./../../../../data/contracts/director/director.types.ck#L24)
 */
export const LineupItem = z.strictObject({
    id: z.string().min(1).max(100).describe("The lineup's own id for this line, which is what an edit names. Not the rundown item id"),
    kind: z.enum(['track', 'segment']).describe('Whether this line is a record or something the station says: an ident, a stinger, a talk break'),
    title: z.string().min(1).max(400).describe("The record's title, or the segment's label. What the mount is labelled with while the line airs"),
    artists: z.array(z.string().min(1).max(200)).describe('Empty for a segment, which has no artist'),
    committed: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe('Already handed to the player, and therefore no longer editable. The cursor is the line between this and the rest'),
    durationMs: z.coerce.number().int().min(0).optional(),
    pluginId: z.string().min(1).max(200).optional().describe('Absent on a segment: the station serves its own audio'),
    externalId: z.string().min(1).max(400).optional().describe('Absent on a segment'),
    album: z.string().max(400).optional(),
    artworkUrl: z.string().max(2000).optional(),
    year: z.coerce.number().int().min(0).optional(),
    trackId: z.string().max(100).optional().describe('The canonical catalog track, when this is one the catalog holds'),
    segmentId: z.string().min(1).max(100).optional().describe('Which segment this line plays. Present only on a segment'),
    segmentState: z.enum(['planned', 'rendering', 'ready', 'failed', 'gone']).optional(),
    playable: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .optional()
        .describe(
            'Whether the station can actually air this segment. A line that is not is SKIPPED when the cursor reaches it, rather than held open',
        ),
    segmentError: z
        .string()
        .max(2000)
        .optional()
        .describe('Why this segment will not air, in a sentence: nothing could write it, or nothing could speak it. Present only on a failed one'),
    segmentWriter: z
        .string()
        .max(200)
        .optional()
        .describe("What decided the words: the station's own templates, or the model that wrote them. Absent on a recording somebody made"),
});
export type LineupItem = z.infer<typeof LineupItem>;

/**
 * Put something the station says into a lineup
 * generated from [AddLineupSegmentInput](file://./../../../../data/contracts/director/director.types.ck#L44)
 */
export const AddLineupSegmentInput = z.strictObject({
    segmentId: z.string().min(1).max(100),
    atIndex: z.coerce
        .number()
        .int()
        .min(0)
        .optional()
        .describe(
            'Where to put it. Absent puts it at the end. A position at or before the cursor is refused: the player is already holding that part of the order',
        ),
    overAtMs: z.coerce
        .number()
        .int()
        .min(0)
        .max(600000)
        .optional()
        .describe(
            'Play it OVER the record that follows, this far into it, rather than in the gap before it. The station ducks the music under the voice. Absent plays it between two records, which is the simpler path',
        ),
    revision: z.coerce.number().int().min(0).optional(),
});
export type AddLineupSegmentInput = z.infer<typeof AddLineupSegmentInput>;

/**
 * What the mount lease is renewed against: `audience` airs only while somebody is listening, `always` airs whenever there is a programme
 * generated from [AirMode](file://./../../../../data/contracts/director/director.types.ck#L67)
 */
export const AirMode = z.enum(['audience', 'always']);
export type AirMode = z.infer<typeof AirMode>;

/**
 * What the station does when the running order runs out
 * generated from [StationOnEnd](file://./../../../../data/contracts/director/director.types.ck#L90)
 */
export const StationOnEnd = z.enum(['extend', 'repeat', 'stop']);
export type StationOnEnd = z.infer<typeof StationOnEnd>;

/**
 * Where an item of the running order has got to. `handed` is a promise and `airing` is a fact, which is the distinction everything here is built around
 * generated from [StationItemState](file://./../../../../data/contracts/director/director.types.ck#L93)
 */
export const StationItemState = z.enum(['planned', 'handed', 'airing', 'played', 'skipped']);
export type StationItemState = z.infer<typeof StationItemState>;

/**
 * Put something the station says into the running order
 * generated from [AddStationSegmentInput](file://./../../../../data/contracts/director/director.types.ck#L134)
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
 * generated from [MoveStationItemInput](file://./../../../../data/contracts/director/director.types.ck#L140)
 */
export const MoveStationItemInput = z.strictObject({
    toIndex: z.coerce.number().int().min(0),
});
export type MoveStationItemInput = z.infer<typeof MoveStationItemInput>;

/**
 * Add tracks to the running order now, rather than waiting for it to run short
 * generated from [ExtendStationInput](file://./../../../../data/contracts/director/director.types.ck#L144)
 */
export const ExtendStationInput = z.strictObject({
    count: z.coerce.number().int().min(1).max(100).optional(),
});
export type ExtendStationInput = z.infer<typeof ExtendStationInput>;

/**
 * Add tracks to a lineup now, rather than waiting for it to run short
 * generated from [ExtendLineupInput](file://./../../../../data/contracts/director/director.types.ck#L148)
 */
export const ExtendLineupInput = z.strictObject({
    count: z.coerce.number().int().min(1).max(100).optional(),
});
export type ExtendLineupInput = z.infer<typeof ExtendLineupInput>;

/**
 * An edit, carrying the view of the order it was made against
 * generated from [EditLineupInput](file://./../../../../data/contracts/director/director.types.ck#L152)
 */
export const EditLineupInput = z.strictObject({
    revision: z.coerce
        .number()
        .int()
        .min(0)
        .optional()
        .describe(
            'Absent skips the check. Send it and an edit made against a list that has since changed is refused rather than applied to whatever is in that position now',
        ),
});
export type EditLineupInput = z.infer<typeof EditLineupInput>;

/**
 * Move a line within a lineup
 * generated from [MoveLineupItemInput](file://./../../../../data/contracts/director/director.types.ck#L156)
 */
export const MoveLineupItemInput = z.strictObject({
    toIndex: z.coerce.number().int().min(0),
    revision: z.coerce.number().int().min(0).optional(),
});
export type MoveLineupItemInput = z.infer<typeof MoveLineupItemInput>;

/**
 * One lineup as a list shows it, without its order
 * generated from [LineupSummary](file://./../../../../data/contracts/director/director.types.ck#L12)
 */
export const LineupSummary = z.strictObject({
    id: z.string().min(1).max(100),
    name: z.string().min(1).max(200),
    mode: LineupMode,
    onEnd: LineupOnEnd,
    source: z.string().min(1).max(50).describe('Who built it: `import` or `director`'),
    sourcePluginId: z.string().max(200).optional().describe('Which plugin an imported lineup came from'),
    sourcePlaylistId: z.string().max(400).optional(),
    revision: z.coerce.number().int().min(0).describe('Bumped on every change to the order. Send it back with an edit and a stale one is refused'),
    itemCount: z.coerce.number().int().min(0),
});
export type LineupSummary = z.infer<typeof LineupSummary>;

/**
 * Build a lineup from a plugin playlist
 * generated from [ImportLineupInput](file://./../../../../data/contracts/director/director.types.ck#L81)
 */
export const ImportLineupInput = z.strictObject({
    pluginId: z.string().min(1).max(200),
    playlistId: z.string().min(1).max(400),
    name: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe('What to call it. Absent names it after the plugin, since only the surface that listed the playlist knows its own name for it'),
    mode: LineupMode.optional(),
    onEnd: LineupOnEnd.optional(),
});
export type ImportLineupInput = z.infer<typeof ImportLineupInput>;

/**
 * A lineup and its whole order
 * generated from [Lineup](file://./../../../../data/contracts/director/director.types.ck#L51)
 */
export const Lineup = z.strictObject({
    id: z.string().min(1).max(100),
    name: z.string().min(1).max(200),
    mode: LineupMode,
    onEnd: LineupOnEnd,
    source: z.string().min(1).max(50),
    revision: z.coerce.number().int().min(0),
    cursor: z.coerce
        .number()
        .int()
        .min(0)
        .describe(
            'How far through this lineup the CURRENT broadcast has committed. Zero for a lineup that is not on air, which is honest: nothing has been committed from it',
        ),
    items: z.array(LineupItem),
});
export type Lineup = z.infer<typeof Lineup>;

/**
 * What the station is airing, and whether it is driving at all
 * generated from [StationAir](file://./../../../../data/contracts/director/director.types.ck#L69)
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
});
export type StationAir = z.infer<typeof StationAir>;

/**
 * Change how the station decides to be on air
 * generated from [SetStationAirInput](file://./../../../../data/contracts/director/director.types.ck#L77)
 */
export const SetStationAirInput = z.strictObject({
    airMode: AirMode,
});
export type SetStationAirInput = z.infer<typeof SetStationAirInput>;

/**
 * Put the station on air, building its running order from the top
 * generated from [PutOnAirInput](file://./../../../../data/contracts/director/director.types.ck#L126)
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
    mode: LineupMode.optional(),
    onEnd: StationOnEnd.optional(),
});
export type PutOnAirInput = z.infer<typeof PutOnAirInput>;

/**
 * One item of the live running order, and where it has got to
 * generated from [StationOrderItem](file://./../../../../data/contracts/director/director.types.ck#L95)
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
    segmentId: z.string().min(1).max(100).optional().describe('Which segment this plays. Present only on a segment'),
    segmentState: z.enum(['planned', 'rendering', 'ready', 'failed', 'gone']).optional(),
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
 * generated from [LineupList](file://./../../../../data/contracts/director/director.types.ck#L62)
 */
export const LineupList = z.strictObject({
    lineups: z.array(LineupSummary),
});
export type LineupList = z.infer<typeof LineupList>;

/**
 * The station's live running order: what is airing, item by item
 * generated from [StationOrder](file://./../../../../data/contracts/director/director.types.ck#L116)
 */
export const StationOrder = z.strictObject({
    name: z.string().max(200).describe('What is on, for a console to draw. A label for this broadcast rather than the name of a stored object'),
    mode: LineupMode,
    onEnd: StationOnEnd,
    source: z.string().min(1).max(50).describe('Who built it: `import` or `director`'),
    sourcePluginId: z.string().max(200).optional().describe('Where more material is pulled from, when it came from a playlist'),
    sourcePlaylistId: z.string().max(400).optional(),
    items: z.array(StationOrderItem),
});
export type StationOrder = z.infer<typeof StationOrder>;
