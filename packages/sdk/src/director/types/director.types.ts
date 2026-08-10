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
    /** Why this segment will not air, in a sentence: nothing could write it, or nothing could speak it. Present only on a failed one */
    segmentError?: string;
    /** What decided the words: the station's own templates, or the model that wrote them. Absent on a recording somebody made */
    segmentWriter?: string;
}

/**
 * Put something the station says into a lineup
 * generated from [AddLineupSegmentInput](file://./../../../../../apps/api/data/contracts/director/director.types.ck#L44)
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
 * generated from [AirMode](file://./../../../../../apps/api/data/contracts/director/director.types.ck#L67)
 */
export type AirMode = 'audience' | 'always';

/**
 * What the station does when the running order runs out
 * generated from [StationOnEnd](file://./../../../../../apps/api/data/contracts/director/director.types.ck#L90)
 */
export type StationOnEnd = 'extend' | 'repeat' | 'stop';

/**
 * Where an item of the running order has got to. `handed` is a promise and `airing` is a fact, which is the distinction everything here is built around
 * generated from [StationItemState](file://./../../../../../apps/api/data/contracts/director/director.types.ck#L93)
 */
export type StationItemState = 'planned' | 'handed' | 'airing' | 'played' | 'skipped';

/**
 * Put something the station says into the running order
 * generated from [AddStationSegmentInput](file://./../../../../../apps/api/data/contracts/director/director.types.ck#L134)
 */
export interface AddStationSegmentInput {
    segmentId: string;
    /** Where to put it. Absent puts it at the end. A position already handed to the player is refused */
    atIndex?: number;
    /** Play it OVER the record that follows, this far into it, rather than in the gap before it. Absent plays it between two records, which is the simpler path */
    overAtMs?: number;
}

/**
 * Move an item within the running order
 * generated from [MoveStationItemInput](file://./../../../../../apps/api/data/contracts/director/director.types.ck#L140)
 */
export interface MoveStationItemInput {
    toIndex: number;
}

/**
 * Add tracks to the running order now, rather than waiting for it to run short
 * generated from [ExtendStationInput](file://./../../../../../apps/api/data/contracts/director/director.types.ck#L144)
 */
export interface ExtendStationInput {
    count?: number;
}

/**
 * Add tracks to a lineup now, rather than waiting for it to run short
 * generated from [ExtendLineupInput](file://./../../../../../apps/api/data/contracts/director/director.types.ck#L148)
 */
export interface ExtendLineupInput {
    count?: number;
}

/**
 * An edit, carrying the view of the order it was made against
 * generated from [EditLineupInput](file://./../../../../../apps/api/data/contracts/director/director.types.ck#L152)
 */
export interface EditLineupInput {
    /** Absent skips the check. Send it and an edit made against a list that has since changed is refused rather than applied to whatever is in that position now */
    revision?: number;
}

/**
 * Move a line within a lineup
 * generated from [MoveLineupItemInput](file://./../../../../../apps/api/data/contracts/director/director.types.ck#L156)
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
 * generated from [ImportLineupInput](file://./../../../../../apps/api/data/contracts/director/director.types.ck#L81)
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
 * generated from [Lineup](file://./../../../../../apps/api/data/contracts/director/director.types.ck#L51)
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
 * generated from [StationAir](file://./../../../../../apps/api/data/contracts/director/director.types.ck#L69)
 */
export interface StationAir {
    /** False means the station was stood down. What it was playing is remembered so the console can still say what it was */
    active: boolean;
    /** What puts the station on air. In `audience` mode a station that is active with a full running order is still silent while nobody is connected, which is the intended state and not a fault */
    airMode: AirMode;
    /** What is on. Absent before the station has ever been given anything to play */
    name?: string;
    /** Who built what is on: `import` or `director` */
    source?: string;
    /** Items left before the running order runs out and `onEnd` decides what happens */
    remaining: number;
}

/**
 * Change how the station decides to be on air
 * generated from [SetStationAirInput](file://./../../../../../apps/api/data/contracts/director/director.types.ck#L77)
 */
export interface SetStationAirInput {
    airMode: AirMode;
}

/**
 * Put the station on air, building its running order from the top
 * generated from [PutOnAirInput](file://./../../../../../apps/api/data/contracts/director/director.types.ck#L126)
 */
export interface PutOnAirInput {
    /** The plugin whose playlist to build from. Absent starts empty and lets the station generate its own programming */
    pluginId?: string;
    /** Required alongside `pluginId`. The playlist is READ at this moment rather than copied, so it is never edited by having been aired */
    playlistId?: string;
    /** What to call this broadcast. Absent names it after the plugin, since only the surface that listed the playlist knows its own name for it */
    name?: string;
    mode?: LineupMode;
    onEnd?: StationOnEnd;
}

/**
 * One item of the live running order, and where it has got to
 * generated from [StationOrderItem](file://./../../../../../apps/api/data/contracts/director/director.types.ck#L95)
 */
export interface StationOrderItem {
    /** What an edit names, what rides through the player, and what comes back on its readings */
    id: string;
    /** Whether this is a record or something the station says: an ident, a stinger, a talk break */
    kind: 'track' | 'segment';
    state: StationItemState;
    /** The record's title, or the segment's label. What the mount is labelled with while it airs */
    title: string;
    /** Empty for a segment, which has no artist */
    artists: string[];
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
    /** Which segment this plays. Present only on a segment */
    segmentId?: string;
    segmentState?: 'planned' | 'rendering' | 'ready' | 'failed' | 'gone';
    /** Whether the station can actually air this segment. One that cannot is SKIPPED when it comes round, rather than held open */
    playable?: boolean;
    /** Why this segment will not air, in a sentence. Present only on a failed one */
    segmentError?: string;
    /** What decided the words: the station's own templates, or the model that wrote them. Absent on a recording somebody made */
    segmentWriter?: string;
    /** Heard OVER the record that follows, this far into it, with the music ducked under it. Such an item is never handed to the player in its own right */
    overAtMs?: number;
}

/**
 * generated from [LineupList](file://./../../../../../apps/api/data/contracts/director/director.types.ck#L62)
 */
export interface LineupList {
    lineups: LineupSummary[];
}

/**
 * The station's live running order: what is airing, item by item
 * generated from [StationOrder](file://./../../../../../apps/api/data/contracts/director/director.types.ck#L116)
 */
export interface StationOrder {
    /** What is on, for a console to draw. A label for this broadcast rather than the name of a stored object */
    name: string;
    mode: LineupMode;
    onEnd: StationOnEnd;
    /** Who built it: `import` or `director` */
    source: string;
    /** Where more material is pulled from, when it came from a playlist */
    sourcePluginId?: string;
    sourcePlaylistId?: string;
    items: StationOrderItem[];
}
