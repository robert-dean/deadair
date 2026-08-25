import type { Rating } from '../../catalog/types/catalog.types.js';

/**
 * What kind of programming the station is running, which decides the rules it runs under
 * generated from [StationMode](file://./../../../../../apps/api/data/contracts/director/director.types.ck#L8)
 */
export type StationMode = 'rotation' | 'setlist' | 'feature';

/**
 * What the mount lease is renewed against: `audience` airs only while somebody is listening, `always` airs whenever there is a programme
 * generated from [AirMode](file://./../../../../../apps/api/data/contracts/director/director.types.ck#L11)
 */
export type AirMode = 'audience' | 'always';

/**
 * What the station does when the running order runs out
 * generated from [StationOnEnd](file://./../../../../../apps/api/data/contracts/director/director.types.ck#L27)
 */
export type StationOnEnd = 'extend' | 'repeat' | 'stop';

/**
 * Where an item of the running order has got to. `handed` is a promise and `airing` is a fact, which is the distinction everything here is built around. The three terminal states that are not `played` are three different facts on a page that has to say why the station is silent: `skipped` is the station passing over an item it reached, `removed` is an operator taking one out before its turn, and `unavailable` is a record the station could not obtain the audio for — the only one of the three an operator can act on, since it names a copy rather than a decision
 * generated from [StationItemState](file://./../../../../../apps/api/data/contracts/director/director.types.ck#L30)
 */
export type StationItemState = 'planned' | 'handed' | 'airing' | 'played' | 'skipped' | 'unavailable' | 'removed';

/**
 * Change who is presenting the broadcast that is on air
 * generated from [SetStationHostInput](file://./../../../../../apps/api/data/contracts/director/director.types.ck#L82)
 */
export interface SetStationHostInput {
    /** Who hosts it from here on. Absent hands it back to whichever persona the station has on air, which is what a broadcast that never named one already does */
    personaId?: string;
}

/**
 * Put something the station says into the running order
 * generated from [AddStationSegmentInput](file://./../../../../../apps/api/data/contracts/director/director.types.ck#L86)
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
 * generated from [MoveStationItemInput](file://./../../../../../apps/api/data/contracts/director/director.types.ck#L92)
 */
export interface MoveStationItemInput {
    toIndex: number;
}

/**
 * Add tracks to the running order now, rather than waiting for it to run short
 * generated from [ExtendStationInput](file://./../../../../../apps/api/data/contracts/director/director.types.ck#L96)
 */
export interface ExtendStationInput {
    count?: number;
}

/**
 * Throw away everything the player is not already holding and programme it again. Unlike a shuffle, the records themselves change; unlike putting the station on air, the broadcast continues
 * generated from [ReplanStationInput](file://./../../../../../apps/api/data/contracts/director/director.types.ck#L100)
 */
export interface ReplanStationInput {
    /** How many records to programme. Absent is roughly an hour */
    count?: number;
    /** What the station should play from here on, in your own words. Absent keeps whatever this broadcast was already asked for; an empty string CLEARS it, which hands the programming back to the station's ordinary rotation. It steers every later refill too, not just this one batch */
    brief?: string;
}

/**
 * What the station is airing, and whether it is driving at all
 * generated from [StationAir](file://./../../../../../apps/api/data/contracts/director/director.types.ck#L13)
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
    /** Which slot of the schedule this broadcast belongs to. Absent means nothing scheduled it, which is every station with no schedule */
    slotId?: string;
}

/**
 * Change how the station decides to be on air
 * generated from [SetStationAirInput](file://./../../../../../apps/api/data/contracts/director/director.types.ck#L22)
 */
export interface SetStationAirInput {
    airMode: AirMode;
}

/**
 * Put the station on air, building its running order from the top
 * generated from [PutOnAirInput](file://./../../../../../apps/api/data/contracts/director/director.types.ck#L69)
 */
export interface PutOnAirInput {
    /** The plugin whose playlist to build from. Absent starts empty and lets the station generate its own programming */
    pluginId?: string;
    /** Required alongside `pluginId`. The playlist is READ at this moment rather than copied, so it is never edited by having been aired */
    playlistId?: string;
    /** What to call this broadcast. Absent names it after the plugin, since only the surface that listed the playlist knows its own name for it */
    name?: string;
    /** What the station should play, in your own words: "heavy metal hits". It steers every refill for as long as this broadcast runs, not just the first batch, and it needs a model to programme with. Absent programmes the station the way its own rules do */
    brief?: string;
    /** Who is hosting this broadcast. It rides the running order for as long as the broadcast does, so the presenter cannot drift back mid-show. Absent uses whichever persona the station has on air */
    personaId?: string;
    /** The earliest release year this broadcast plays. Absent means no lower bound, and a record whose year the catalog does not know is played whatever the period */
    eraFrom?: number;
    /** The latest release year, on the same terms. Set with `eraFrom` for a decade; either may stand alone */
    eraTo?: number;
    /** Whether somebody phones in during this broadcast. A call is a short programme rather than a break: a few turns in a few voices, entering the running order as one block, spaced by `rotation.callinEveryMinutes`. Absent takes the station's own setting, which is off */
    callins?: boolean;
    mode?: StationMode;
    onEnd?: StationOnEnd;
}

/**
 * One item of the live running order, and where it has got to
 * generated from [StationOrderItem](file://./../../../../../apps/api/data/contracts/director/director.types.ck#L32)
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
    /** The canonical artist behind that track, so a console can reach their page from the running order. Absent on a segment, and on a record the catalog has never seen */
    artistId?: string;
    /** The release that track was ingested inside. Absent for the two reasons above and for a third: a single ingested outside any release has none */
    albumId?: string;
    /** What the station thinks of this record, read as the order is drawn rather than stored on it. Absent on a segment, and on a record the catalog has never seen */
    rating?: Rating;
    /** Which segment this plays. Present only on a segment */
    segmentId?: string;
    segmentState?: 'planned' | 'writing' | 'written' | 'rendering' | 'ready' | 'failed' | 'gone';
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
 * The station's live running order: what is airing, item by item
 * generated from [StationOrder](file://./../../../../../apps/api/data/contracts/director/director.types.ck#L56)
 */
export interface StationOrder {
    /** What is on, for a console to draw. A label for this broadcast rather than the name of a stored object */
    name: string;
    /** What the operator asked the station to play, in their own words. It keeps steering every refill until the station is put on air again, so a console should show it rather than only accept it */
    brief?: string;
    /** Who is hosting this broadcast, when it named somebody. Absent means whichever persona the station has on air */
    personaId?: string;
    /** What that host is called, resolved as the order is read so a console need not fetch the persona list to draw a name */
    personaLabel?: string;
    mode: StationMode;
    onEnd: StationOnEnd;
    /** Who built it: `import` or `director` */
    source: string;
    /** Where more material is pulled from, when it came from a playlist */
    sourcePluginId?: string;
    sourcePlaylistId?: string;
    items: StationOrderItem[];
}
