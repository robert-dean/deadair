import type { ProviderPlaylist, ProviderTrack } from '@deadair/plugin-sdk';

import type { EmbyItem } from './emby.types.js';

/**
 * Emby's shapes as deadair's.
 *
 * Pure functions with no client and no host: everything here is a rearrangement
 * of a document somebody else already fetched, which is what makes it testable
 * without a single scripted response.
 */

/** Ticks per millisecond. Emby measures every duration in ticks of 100 nanoseconds. */
const TICKS_PER_MS = 10_000;

/**
 * An Emby item id: a whole number, written as a string. Not the 32-hex GUID Jellyfin writes, though the
 * two servers share an ancestor: measured on Emby 4.10.1, a track is `"12"` and a playlist `"34"`.
 */
export const ITEM_ID = /^\d+$/;

/** Ticks to whole milliseconds, per the boundary rule that durations are integers. */
export const durationMs = (ticks: number | null | undefined): number | undefined =>
    typeof ticks === 'number' && Number.isFinite(ticks) && ticks > 0 ? Math.round(ticks / TICKS_PER_MS) : undefined;

/** A trimmed non-empty string, or nothing. Emby sends `null` and `""` alike for a field it has no value for. */
export const text = (value: string | null | undefined): string | undefined => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
};

/**
 * A tagged release year, or nothing. The bounds catch a tag that is a catalogue
 * number or a timestamp, which is what a wrong year tag usually is.
 */
export const releaseYear = (value: number | null | undefined): number | undefined =>
    typeof value === 'number' && Number.isInteger(value) && value >= 1900 && value <= 2100 ? value : undefined;

/** A track or disc number worth passing on: a whole number from 1. A zero is a tag nobody filled in. */
const position = (value: number | null | undefined): number | undefined =>
    typeof value === 'number' && Number.isInteger(value) && value > 0 && value < 1000 ? value : undefined;

/**
 * A server's sentinel for a tag it never got, sent as if it were the tag itself.
 * Anchored against the whole credit, so a real artist whose name contains one of
 * these words is not mistaken for one.
 */
const PLACEHOLDER = /^\[?(unknown|various|no) (artist|album)s?\]?$/i;

/** The credited artists, primary first, with placeholders and blanks left out. */
function artistsOf(item: EmbyItem): string[] {
    const named = (item.Artists ?? []).map(text).filter((name): name is string => name !== undefined && !PLACEHOLDER.test(name));
    if (named.length > 0) return named;

    // A file with an album-artist tag and no artist tag still says who made it.
    const albumArtist = text(item.AlbumArtist);
    return albumArtist && !PLACEHOLDER.test(albumArtist) ? [albumArtist] : [];
}

/**
 * One track.
 *
 * `artworkUrl` is left to the caller, because building it needs the server's
 * address and this file has none. No `isrc`: Emby reads none from a file's
 * tags.
 *
 * Anything that is not an `Audio` item is refused, because Emby will hand
 * back whatever an id names: a lookup by an id that turned out to be an album or
 * a folder must read as "no such track" rather than as a track called "Music".
 */
export function mapTrack(item: EmbyItem, artworkUrl?: string): ProviderTrack | undefined {
    const id = text(item.Id);
    if (!id || item.Type !== 'Audio') return undefined;

    const album = text(item.Album);
    const duration = durationMs(item.RunTimeTicks);
    const year = releaseYear(item.ProductionYear);
    const trackNumber = position(item.IndexNumber);
    const discNumber = position(item.ParentIndexNumber);

    return {
        id,
        title: text(item.Name) ?? 'Untitled',
        // A real list, unlike Subsonic's one string: Emby splits a credit on
        // the separators the operator configured, so "Tyler, The Creator" stays one.
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
export const mapTracks = (items: EmbyItem[] | null | undefined, artworkUrl?: (item: EmbyItem) => string | undefined): ProviderTrack[] =>
    (items ?? []).map(item => mapTrack(item, artworkUrl?.(item))).filter((track): track is ProviderTrack => track !== undefined);

/**
 * One playlist.
 *
 * `permissions` is deliberately left unset: Emby reports no read/edit split
 * in this listing, and the SDK reads absent as "the source did not say" where
 * `[]` would mean "nothing is allowed" and hide the playlist from the console.
 */
export function mapPlaylist(item: EmbyItem, artworkUrl?: string): ProviderPlaylist | undefined {
    const id = text(item.Id);
    if (!id) return undefined;

    const description = text(item.Overview);
    return {
        id,
        name: text(item.Name) ?? 'Untitled playlist',
        ...(description ? { description } : {}),
        ...(typeof item.ChildCount === 'number' ? { trackCount: item.ChildCount } : {}),
        ...(artworkUrl ? { artworkUrl } : {}),
    };
}

/**
 * The item a link into THIS server's web app names: `<baseUrl>/web/index.html#!/item?id=<id>&serverId=…`,
 * which is what the address bar shows on a playlist's page (read out of the 4.10.1 web app's router). Only
 * a link to the server this plugin is configured for is ours: another server's ids mean nothing here.
 *
 * The link does not say what kind of item it names, so an album's page is claimed too. The playlist
 * endpoint then refuses that id, which is the right answer to somebody who pasted an album.
 */
export function embyPlaylistIdFromUrl(url: string, baseUrl: string | undefined): string | undefined {
    if (baseUrl === undefined) return undefined;

    let parsed: URL;
    let base: URL;
    try {
        parsed = new URL(url.trim());
        base = new URL(baseUrl);
    } catch {
        return undefined;
    }
    if (parsed.origin !== base.origin) return undefined;
    const root = base.pathname.replace(/\/+$/, '');
    if (!parsed.pathname.startsWith(`${root}/web`)) return undefined;

    const match = /^#!?\/item\?(.*)$/.exec(parsed.hash);
    if (!match) return undefined;
    const id = new URLSearchParams(match[1]).get('id') ?? undefined;
    return id !== undefined && ITEM_ID.test(id) ? id : undefined;
}
