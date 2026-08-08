/**
 * What kind of programming a lineup is, which decides the rules it runs under
 * generated from [LineupMode](file://./../../../../../apps/api/data/contracts/director/director.types.ck#L8)
 */
export type LineupMode = 'rotation' | 'setlist' | 'feature';

/**
 * generated from [LineupOnEnd](file://./../../../../../apps/api/data/contracts/director/director.types.ck#L10)
 */
export type LineupOnEnd = 'extend' | 'repeat' | 'resume' | 'rotation' | 'stop';

/**
 * One line of a lineup, which is either a record or something the station says
 * generated from [LineupItem](file://./../../../../../apps/api/data/contracts/director/director.types.ck#L24)
 */
export interface LineupItem {
    /** The lineup's own id for this line, which is what an edit names. Not the rundown item id */
    id: string;
    /** Whether this line is a record or something the station says: an ident, a stinger, a talk break */
    kind: 'track' | 'segment';
    /** The record's title, or the segment's label. What the mount is labelled with while the line airs */
    title: string;
    /** Empty for a segment, which has no artist */
    artists: string[];
    /** Already handed to the player, and therefore no longer editable. The cursor is the line between this and the rest */
    committed: boolean;
    durationMs?: number;
    /** Absent on a segment: the station serves its own audio */
    pluginId?: string;
    /** Absent on a segment */
    externalId?: string;
    album?: string;
    artworkUrl?: string;
    year?: number;
    /** The canonical catalog track, when this is one the catalog holds */
    trackId?: string;
    /** Which segment this line plays. Present only on a segment */
    segmentId?: string;
    segmentState?: 'planned' | 'rendering' | 'ready' | 'failed' | 'gone';
    /** Whether the station can actually air this segment. A line that is not is SKIPPED when the cursor reaches it, rather than held open */
    playable?: boolean;
}

/**
 * Put something the station says into a lineup
 * generated from [AddLineupSegmentInput](file://./../../../../../apps/api/data/contracts/director/director.types.ck#L48)
 */
export interface AddLineupSegmentInput {
    segmentId: string;
    /** Where to put it. Absent puts it at the end. A position at or before the cursor is refused: the player is already holding that part of the order */
    atIndex?: number;
    /** Play it OVER the record that follows, this far into it, rather than in the gap before it. The station ducks the music under the voice. Absent plays it between two records, which is the simpler path */
    overAtMs?: number;
    revision?: number;
}

/**
 * What the mount lease is renewed against: `audience` airs only while somebody is listening, `always` airs whenever there is a programme
 * generated from [AirMode](file://./../../../../../apps/api/data/contracts/director/director.types.ck#L71)
 */
export type AirMode = 'audience' | 'always';

/**
 * Put a lineup on air, from the top
 * generated from [PutOnAirInput](file://./../../../../../apps/api/data/contracts/director/director.types.ck#L94)
 */
export interface PutOnAirInput {
    lineupId: string;
    /** Remember what this displaced, so a lineup ending with `resume` hands the station back to it. What an album feature wants; not what an operator changing programming wants */
    interrupting?: boolean;
}

/**
 * Add tracks to a lineup now, rather than waiting for it to run short
 * generated from [ExtendLineupInput](file://./../../../../../apps/api/data/contracts/director/director.types.ck#L99)
 */
export interface ExtendLineupInput {
    count?: number;
}

/**
 * An edit, carrying the view of the order it was made against
 * generated from [EditLineupInput](file://./../../../../../apps/api/data/contracts/director/director.types.ck#L103)
 */
export interface EditLineupInput {
    /** Absent skips the check. Send it and an edit made against a list that has since changed is refused rather than applied to whatever is in that position now */
    revision?: number;
}

/**
 * Move a line within a lineup
 * generated from [MoveLineupItemInput](file://./../../../../../apps/api/data/contracts/director/director.types.ck#L107)
 */
export interface MoveLineupItemInput {
    toIndex: number;
    revision?: number;
}

/**
 * One lineup as a list shows it, without its order
 * generated from [LineupSummary](file://./../../../../../apps/api/data/contracts/director/director.types.ck#L12)
 */
export interface LineupSummary {
    id: string;
    name: string;
    mode: LineupMode;
    onEnd: LineupOnEnd;
    /** Who built it: `import` or `director` */
    source: string;
    /** Which plugin an imported lineup came from */
    sourcePluginId?: string;
    sourcePlaylistId?: string;
    /** Bumped on every change to the order. Send it back with an edit and a stale one is refused */
    revision: number;
    itemCount: number;
}

/**
 * Build a lineup from a plugin playlist
 * generated from [ImportLineupInput](file://./../../../../../apps/api/data/contracts/director/director.types.ck#L86)
 */
export interface ImportLineupInput {
    pluginId: string;
    playlistId: string;
    /** What to call it. Absent names it after the plugin, since only the surface that listed the playlist knows its own name for it */
    name?: string;
    mode?: LineupMode;
    onEnd?: LineupOnEnd;
}

/**
 * A lineup and its whole order
 * generated from [Lineup](file://./../../../../../apps/api/data/contracts/director/director.types.ck#L55)
 */
export interface Lineup {
    id: string;
    name: string;
    mode: LineupMode;
    onEnd: LineupOnEnd;
    source: string;
    revision: number;
    /** How far through this lineup the CURRENT broadcast has committed. Zero for a lineup that is not on air, which is honest: nothing has been committed from it */
    cursor: number;
    items: LineupItem[];
}

/**
 * What the station is airing, and whether it is driving at all
 * generated from [StationAir](file://./../../../../../apps/api/data/contracts/director/director.types.ck#L73)
 */
export interface StationAir {
    /** False means the station was stood down. The lineup is remembered so the console can still say what it was playing */
    active: boolean;
    /** What puts the station on air. In `audience` mode a station that is active with a full running order is still silent while nobody is connected, which is the intended state and not a fault */
    airMode: AirMode;
    lineupId?: string;
    lineupName?: string;
    cursor: number;
    /** Lines left in the lineup before it runs out and `onEnd` decides what happens */
    remaining: number;
}

/**
 * Change how the station decides to be on air
 * generated from [SetStationAirInput](file://./../../../../../apps/api/data/contracts/director/director.types.ck#L82)
 */
export interface SetStationAirInput {
    airMode: AirMode;
}

/**
 * generated from [LineupList](file://./../../../../../apps/api/data/contracts/director/director.types.ck#L66)
 */
export interface LineupList {
    lineups: LineupSummary[];
}
