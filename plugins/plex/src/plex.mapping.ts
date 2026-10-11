import type { ProviderPlaylist, ProviderTrack } from '@deadair/plugin-sdk';

import type { PlexMetadata } from './plex.types.js';

/**
 * Plex's shapes as deadair's.
 *
 * Pure functions with no client and no host: everything here is a rearrangement
 * of a document somebody else already fetched.
 */

/** A Plex rating key: a whole number, written as a string. */
export const RATING_KEY = /^\d+$/;

/** A trimmed non-empty string, or nothing. */
export const text = (value: string | undefined): string | undefined => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
};

/** Plex already counts in milliseconds; this only refuses a value that is not a positive whole number. */
const durationMs = (value: number | undefined): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : undefined;

/** A tagged release year, or nothing. The bounds catch a tag that is a catalogue number or a timestamp. */
const releaseYear = (value: number | undefined): number | undefined =>
    typeof value === 'number' && Number.isInteger(value) && value >= 1900 && value <= 2100 ? value : undefined;

/** A track or disc number worth passing on: a whole number from 1. */
const position = (value: number | undefined): number | undefined =>
    typeof value === 'number' && Number.isInteger(value) && value > 0 && value < 1000 ? value : undefined;

/**
 * A server's sentinel for a tag it never got, sent as if it were the tag itself.
 * Anchored against the whole credit, so a real artist whose name contains one of
 * these words is not mistaken for one.
 */
const PLACEHOLDER = /^\[?(unknown|various|no) (artist|album)s?\]?$/i;

/**
 * Who made a track.
 *
 * `originalTitle` first, because Plex sets it only when the track's own artist
 * differs from the album's: on a compilation the album artist is "Various
 * Artists" and the track's artist is the one that matters. One string either
 * way, so one artist: splitting on commas would invent a duo out of "Tyler, The
 * Creator".
 */
function artistsOf(item: PlexMetadata): string[] {
    for (const candidate of [item.originalTitle, item.grandparentTitle]) {
        const name = text(candidate);
        if (name && !PLACEHOLDER.test(name)) return [name];
    }
    return [];
}

/** The year a track belongs to: its own when Plex has one, else its album's. */
export const trackYear = (item: PlexMetadata): number | undefined => releaseYear(item.year) ?? releaseYear(item.parentYear);

/**
 * One track.
 *
 * `artworkUrl` is left to the caller, because building it needs the server and
 * the token. Anything that is not a `track` is refused, so a lookup by an id
 * that turned out to be an album reads as "no such track".
 */
export function mapTrack(item: PlexMetadata, artworkUrl?: string): ProviderTrack | undefined {
    const id = text(item.ratingKey);
    if (!id || item.type !== 'track') return undefined;

    const album = text(item.parentTitle);
    const duration = durationMs(item.duration);
    const year = trackYear(item);
    const trackNumber = position(item.index);
    const discNumber = position(item.parentIndex);

    return {
        id,
        title: text(item.title) ?? 'Untitled',
        artists: artistsOf(item),
        ...(album && !PLACEHOLDER.test(album) ? { album } : {}),
        ...(duration === undefined ? {} : { durationMs: duration }),
        ...(artworkUrl ? { artworkUrl } : {}),
        ...(year === undefined ? {} : { year }),
        ...(trackNumber === undefined ? {} : { trackNumber }),
        ...(discNumber === undefined ? {} : { discNumber }),
    };
}

/** Every track in a list, in the order the server gave them. */
export const mapTracks = (items: PlexMetadata[] | undefined, artworkUrl?: (item: PlexMetadata) => string | undefined): ProviderTrack[] =>
    (items ?? []).map(item => mapTrack(item, artworkUrl?.(item))).filter((track): track is ProviderTrack => track !== undefined);

/**
 * The path of the file a track is served from: the first part of its first
 * version. A track Plex holds in several versions is aired from whichever it
 * lists first, which is the one Plex itself plays by default.
 */
export const partKey = (item: PlexMetadata): string | undefined => text(item.Media?.[0]?.Part?.[0]?.key);

/**
 * One playlist.
 *
 * `permissions` is deliberately left unset: Plex reports no read/edit split for
 * the token's account, and the SDK reads absent as "the source did not say".
 */
export function mapPlaylist(item: PlexMetadata, artworkUrl?: string): ProviderPlaylist | undefined {
    const id = text(item.ratingKey);
    if (!id) return undefined;

    const description = text(item.summary);
    return {
        id,
        name: text(item.title) ?? 'Untitled playlist',
        ...(description ? { description } : {}),
        ...(typeof item.leafCount === 'number' ? { trackCount: item.leafCount } : {}),
        ...(artworkUrl ? { artworkUrl } : {}),
    };
}

/**
 * The playlist a link into Plex Web names, when the link is to THIS server.
 *
 * Plex Web shows a playlist at `…#!/server/<machine id>/playlist?key=/playlists/<rating key>`,
 * whether it is served by app.plex.tv or by the server itself under `/web`. The machine id is what
 * makes it ours: a playlist on somebody else's server has a rating key that means nothing here, so
 * without the id this plugin's server answers with, nothing is claimed.
 */
export function plexPlaylistIdFromUrl(url: string, machineIdentifier: string | undefined): string | undefined {
    if (machineIdentifier === undefined) return undefined;

    let parsed: URL;
    try {
        parsed = new URL(url.trim());
    } catch {
        return undefined;
    }

    const match = /^#!?\/server\/([^/]+)\/playlist\?(.*)$/.exec(parsed.hash);
    if (!match || match[1] !== machineIdentifier) return undefined;
    const key = new URLSearchParams(match[2]).get('key') ?? '';
    const id = /^\/playlists\/(\d+)$/.exec(key)?.[1];
    return id;
}
