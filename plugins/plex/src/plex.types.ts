/**
 * The parts of Plex's JSON responses this plugin reads.
 *
 * Every response is a `MediaContainer` holding `Metadata` (items) or
 * `Directory` (libraries) arrays. Every field is optional because Plex leaves
 * out whatever it has no value for. Named as Plex names them, so a field here
 * can be found in a server's own XML by searching for it.
 */

/** A file a track's media is stored in. `key` is the path the file is served at. */
export interface PlexPart {
    key?: string;
    container?: string;
}

/** One version of a track. A track may have several; each has its parts. */
export interface PlexMedia {
    Part?: PlexPart[];
}

/** An id the item is known by elsewhere, such as `mbid://…`. Only present when `includeGuids=1` asked. */
export interface PlexGuid {
    id?: string;
}

/** One entry of a tag list: a genre, a style, a mood. */
export interface PlexTag {
    tag?: string;
}

/** A track, an artist, an album or a playlist. */
export interface PlexMetadata {
    /** The item's id on this server: a number, written as a string. */
    ratingKey?: string;
    /** Plex's own id for the thing (`plex://track/…`), the same on every server and kept across a rescan. */
    guid?: string;
    /** On a track: the album's artist's rating key. */
    grandparentRatingKey?: string;
    /** On a track: the album's rating key. On an album: the artist's. */
    parentRatingKey?: string;
    /** On an album: its label. */
    studio?: string;
    /** On a track: its album's label. */
    parentStudio?: string;
    /** On an album: its release date, `YYYY-MM-DD`. */
    originallyAvailableAt?: string;
    /** The broad genre, such as `Pop/Rock`. */
    Genre?: PlexTag[];
    /** The narrower genres, such as `Power Metal`. Albums and artists only. */
    Style?: PlexTag[];
    Mood?: PlexTag[];
    /** `track`, `artist`, `album`, `playlist`. */
    type?: string;
    title?: string;
    /** On a track: the album. */
    parentTitle?: string;
    /** On a track: the album artist. */
    grandparentTitle?: string;
    /** On a track: the track's own artist, set when it differs from the album artist (a compilation, a guest). */
    originalTitle?: string;
    /** In milliseconds. */
    duration?: number;
    /** On a track: its own year, which Plex rarely fills. */
    year?: number;
    /** On a track: the album's year. */
    parentYear?: number;
    /** The track number. */
    index?: number;
    /** The disc number. */
    parentIndex?: number;
    /** Image paths on the server, each ending in a version stamp. */
    thumb?: string;
    parentThumb?: string;
    grandparentThumb?: string;
    /** On a playlist: a picture Plex composes from its items. */
    composite?: string;
    /** On a playlist: how many items it holds. */
    leafCount?: number;
    /** On a playlist: its description. On an artist: a biography. On an album: a review. */
    summary?: string;
    /** On a playlist: `audio`, `video` or `photo`. */
    playlistType?: string;
    /** On a playlist: whether Plex fills it from a rule. */
    smart?: boolean;
    Media?: PlexMedia[];
    Guid?: PlexGuid[];
}

/** A library section, from `/library/sections`. Music libraries have `type: 'artist'`. */
export interface PlexDirectory {
    key?: string;
    type?: string;
    title?: string;
}

/** Every response's envelope. */
export interface PlexContainer {
    MediaContainer?: {
        size?: number;
        totalSize?: number;
        friendlyName?: string;
        version?: string;
        machineIdentifier?: string;
        Metadata?: PlexMetadata[];
        Directory?: PlexDirectory[];
    };
}
