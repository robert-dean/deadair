import { z } from 'zod';

/**
 * What kind of programming a lineup is, which decides the rules it runs under
 * generated from [LineupMode](file://./../../../../data/contracts/director/director.types.ck#L8)
 */
export const LineupMode = z.enum(['rotation', 'setlist', 'feature']);
export type LineupMode = z.infer<typeof LineupMode>;

/**
 * generated from [LineupOnEnd](file://./../../../../data/contracts/director/director.types.ck#L11)
 */
export const LineupOnEnd = z.enum(['extend', 'repeat', 'resume', 'rotation', 'stop']);
export type LineupOnEnd = z.infer<typeof LineupOnEnd>;

/**
 * One line of a lineup
 * generated from [LineupItem](file://./../../../../data/contracts/director/director.types.ck#L25)
 */
export const LineupItem = z.strictObject({
    id: z.string().min(1).max(100).describe("The lineup's own id for this line, which is what an edit names. Not the rundown item id"),
    pluginId: z.string().min(1).max(200),
    externalId: z.string().min(1).max(400),
    title: z.string().min(1).max(400),
    artists: z.array(z.string().min(1).max(200)),
    durationMs: z.coerce.number().int().min(0).optional(),
    album: z.string().max(400).optional(),
    artworkUrl: z.string().max(2000).optional(),
    year: z.coerce.number().int().min(0).optional(),
    trackId: z.string().max(100).optional().describe('The canonical catalog track, when this is one the catalog holds'),
    committed: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe('Already handed to the player, and therefore no longer editable. The cursor is the line between this and the rest'),
});
export type LineupItem = z.infer<typeof LineupItem>;

/**
 * What the mount lease is renewed against: `audience` airs only while somebody is listening, `always` airs whenever there is a programme
 * generated from [AirMode](file://./../../../../data/contracts/director/director.types.ck#L55)
 */
export const AirMode = z.enum(['audience', 'always']);
export type AirMode = z.infer<typeof AirMode>;

/**
 * Put a lineup on air, from the top
 * generated from [PutOnAirInput](file://./../../../../data/contracts/director/director.types.ck#L78)
 */
export const PutOnAirInput = z.strictObject({
    lineupId: z.string().min(1).max(100),
    interrupting: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .optional()
        .describe(
            'Remember what this displaced, so a lineup ending with `resume` hands the station back to it. What an album feature wants; not what an operator changing programming wants',
        ),
});
export type PutOnAirInput = z.infer<typeof PutOnAirInput>;

/**
 * Add tracks to a lineup now, rather than waiting for it to run short
 * generated from [ExtendLineupInput](file://./../../../../data/contracts/director/director.types.ck#L83)
 */
export const ExtendLineupInput = z.strictObject({
    count: z.coerce.number().int().min(1).max(100).optional(),
});
export type ExtendLineupInput = z.infer<typeof ExtendLineupInput>;

/**
 * An edit, carrying the view of the order it was made against
 * generated from [EditLineupInput](file://./../../../../data/contracts/director/director.types.ck#L87)
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
 * generated from [MoveLineupItemInput](file://./../../../../data/contracts/director/director.types.ck#L91)
 */
export const MoveLineupItemInput = z.strictObject({
    toIndex: z.coerce.number().int().min(0),
    revision: z.coerce.number().int().min(0).optional(),
});
export type MoveLineupItemInput = z.infer<typeof MoveLineupItemInput>;

/**
 * One lineup as a list shows it, without its order
 * generated from [LineupSummary](file://./../../../../data/contracts/director/director.types.ck#L13)
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
 * generated from [ImportLineupInput](file://./../../../../data/contracts/director/director.types.ck#L70)
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
 * generated from [Lineup](file://./../../../../data/contracts/director/director.types.ck#L39)
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
 * generated from [StationAir](file://./../../../../data/contracts/director/director.types.ck#L57)
 */
export const StationAir = z.strictObject({
    active: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe('False means the station was stood down. The lineup is remembered so the console can still say what it was playing'),
    airMode: AirMode.describe(
        'What puts the station on air. In `audience` mode a station that is active with a full running order is still silent while nobody is connected, which is the intended state and not a fault',
    ),
    lineupId: z.string().max(100).optional(),
    lineupName: z.string().max(200).optional(),
    cursor: z.coerce.number().int().min(0),
    remaining: z.coerce.number().int().min(0).describe('Lines left in the lineup before it runs out and `onEnd` decides what happens'),
});
export type StationAir = z.infer<typeof StationAir>;

/**
 * Change how the station decides to be on air
 * generated from [SetStationAirInput](file://./../../../../data/contracts/director/director.types.ck#L66)
 */
export const SetStationAirInput = z.strictObject({
    airMode: AirMode,
});
export type SetStationAirInput = z.infer<typeof SetStationAirInput>;

/**
 * generated from [LineupList](file://./../../../../data/contracts/director/director.types.ck#L50)
 */
export const LineupList = z.strictObject({
    lineups: z.array(LineupSummary),
});
export type LineupList = z.infer<typeof LineupList>;
