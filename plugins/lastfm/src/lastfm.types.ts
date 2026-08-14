/**
 * The shapes Last.fm answers with, as far as this plugin reads them.
 *
 * Partial by design and optional throughout: the service omits fields rather
 * than nulling them, returns a bare object where a list has one entry, and
 * numbers everything as strings. Nothing here is trusted to be present.
 */

/** Every response carries these on a failure, with HTTP 200. See `lastfm.client.ts`. */
export interface LastfmErrorResponse {
    error?: number;
    message?: string;
}

/**
 * A tag, as it appears under `toptags` / `tags`.
 *
 * `count` is 0-100 relative to the entity's most-applied tag on `getInfo`
 * responses, and an absolute number of taggings elsewhere. This plugin only
 * reads it from `getInfo`, where the scale is the relative one.
 */
export interface LastfmTag {
    name?: string;
    count?: number | string;
    url?: string;
}

/** Last.fm returns a single-entry list as a bare object about half the time. */
export type LastfmMaybeList<T> = T[] | T | undefined;

export interface LastfmImage {
    '#text'?: string;
    size?: string;
}

export interface LastfmArtistRef {
    name?: string;
    mbid?: string;
    url?: string;
}

export interface LastfmWiki {
    published?: string;
    summary?: string;
    content?: string;
}

export interface LastfmStats {
    listeners?: string;
    playcount?: string;
    userplaycount?: string;
}

export interface LastfmArtist {
    name?: string;
    mbid?: string;
    url?: string;
    image?: LastfmImage[];
    stats?: LastfmStats;
    similar?: { artist?: LastfmMaybeList<LastfmArtistRef & { match?: string | number }> };
    tags?: { tag?: LastfmMaybeList<LastfmTag> };
    bio?: LastfmWiki;
}

export interface LastfmArtistInfoResponse {
    artist?: LastfmArtist;
}

export interface LastfmSimilarArtistsResponse {
    similarartists?: {
        artist?: LastfmMaybeList<LastfmArtistRef & { match?: string | number }>;
    };
}

export interface LastfmTrack {
    name?: string;
    mbid?: string;
    url?: string;
    duration?: string | number;
    listeners?: string;
    playcount?: string;
    artist?: LastfmArtistRef | string;
    album?: {
        artist?: string;
        title?: string;
        mbid?: string;
        image?: LastfmImage[];
        '@attr'?: { position?: string };
    };
    toptags?: { tag?: LastfmMaybeList<LastfmTag> };
    wiki?: LastfmWiki;
}

export interface LastfmTrackInfoResponse {
    track?: LastfmTrack;
}

export interface LastfmAlbum {
    name?: string;
    artist?: string;
    mbid?: string;
    url?: string;
    image?: LastfmImage[];
    listeners?: string;
    playcount?: string;
    tags?: { tag?: LastfmMaybeList<LastfmTag> } | string;
    wiki?: LastfmWiki;
}

export interface LastfmAlbumInfoResponse {
    album?: LastfmAlbum;
}

/** `artist.getTopTracks`, `chart.getTopTracks`, `geo.getTopTracks` and `tag.getTopTracks` all land here. */
export interface LastfmTopTracksResponse {
    toptracks?: { track?: LastfmMaybeList<LastfmTrack> };
    tracks?: { track?: LastfmMaybeList<LastfmTrack> };
}

export interface LastfmTokenResponse {
    token?: string;
}

export interface LastfmSessionResponse {
    session?: {
        name?: string;
        key?: string;
        subscriber?: number;
    };
}

/**
 * One play's fate in a `track.scrobble` response.
 *
 * `ignoredMessage.code` is the whole reason this type is read at all: it is what
 * separates "we will never take this" from "try again later", which is the
 * distinction the host's queue is built on.
 */
export interface LastfmScrobbleEntry {
    ignoredMessage?: { code?: string | number; '#text'?: string };
    artist?: { '#text'?: string };
    track?: { '#text'?: string };
    timestamp?: string;
}

export interface LastfmScrobbleResponse {
    scrobbles?: {
        '@attr'?: { accepted?: number | string; ignored?: number | string };
        scrobble?: LastfmMaybeList<LastfmScrobbleEntry>;
    };
}

/** Whatever the service returned for a field that is a list or a lone object, as a list. */
export function asList<T>(value: LastfmMaybeList<T>): T[] {
    if (value === undefined) return [];
    return Array.isArray(value) ? value : [value];
}

/** A number Last.fm sent as a string, or `undefined` for anything that is not one. */
export function asNumber(value: string | number | undefined): number | undefined {
    if (value === undefined) return undefined;
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

/** The artist of a track, which the service gives as an object in some responses and a string in others. */
export function artistNameOf(artist: LastfmArtistRef | string | undefined): string | undefined {
    if (artist === undefined) return undefined;
    const name = typeof artist === 'string' ? artist : artist.name;
    return name?.trim() ? name.trim() : undefined;
}

/**
 * The largest image on an entity.
 *
 * Last.fm orders them small to extralarge, so the last one with a URL is the
 * biggest. Note that artist images have been placeholders since they lost the
 * rights to them — every artist answers with the same star graphic — which is
 * why `mapArtist` deliberately does not use this for `imageUrl`.
 */
export function largestImage(images: LastfmImage[] | undefined): string | undefined {
    if (!images) return undefined;
    for (let index = images.length - 1; index >= 0; index -= 1) {
        const url = images[index]?.['#text']?.trim();
        if (url) return url;
    }
    return undefined;
}
