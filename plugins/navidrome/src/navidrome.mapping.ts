import type { ProviderPlaylist, ProviderTrack } from '@deadair/plugin-sdk';

import type { SubsonicChild, SubsonicPlaylist } from './navidrome.types.js';

/**
 * Subsonic's shapes as deadair's.
 *
 * Pure functions with no client and no host: everything here is a rearrangement
 * of a document somebody else already fetched, which is what makes it testable
 * without a single scripted response.
 */

/** Seconds to whole milliseconds, per the boundary rule that durations are integers. */
export const durationMs = (seconds: number | undefined): number | undefined =>
    typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : undefined;

/** A trimmed non-empty string, or nothing. Subsonic sends `""` for fields it has no value for. */
export const text = (value: string | undefined): string | undefined => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
};

/**
 * The genres a song or record claims.
 *
 * OpenSubsonic's `genres[]` when the server sends it, falling back to the legacy
 * single `genre`. Navidrome sends both, and the array is the better answer: a
 * track tagged "trip hop; downtempo" is two genres, and the legacy field can
 * only hold whichever one the server picked.
 */
export const genreNames = (item: { genre?: string; genres?: { name?: string }[] }): string[] => {
    const named = (item.genres ?? []).map(entry => text(entry.name)).filter((name): name is string => name !== undefined);
    if (named.length > 0) return named;

    const single = text(item.genre);
    return single ? [single] : [];
};

/**
 * One song.
 *
 * `artworkUrl` is left to the caller, because minting it needs credentials and
 * this file has none. No `isrc`: Subsonic has no field for one, which is why
 * the plugin matches on artist-and-title when it answers enrichment questions.
 */
export function mapTrack(song: SubsonicChild, artworkUrl?: string): ProviderTrack | undefined {
    const id = text(song.id);
    if (!id) return undefined;

    const artist = text(song.artist);

    return {
        id,
        title: text(song.title) ?? 'Untitled',
        // An array because a provider may know several. Subsonic knows one string,
        // and splitting it on commas would invent a duo out of "Tyler, The Creator".
        artists: artist ? [artist] : [],
        ...(text(song.album) ? { album: text(song.album) } : {}),
        ...(durationMs(song.duration) !== undefined ? { durationMs: durationMs(song.duration) } : {}),
        ...(artworkUrl ? { artworkUrl } : {}),
    };
}

/** Every song in a list that has an id, in the order the server gave them. */
export const mapTracks = (songs: SubsonicChild[] | undefined, artworkUrl?: (song: SubsonicChild) => string | undefined): ProviderTrack[] =>
    (songs ?? []).map(song => mapTrack(song, artworkUrl?.(song))).filter((track): track is ProviderTrack => track !== undefined);

/**
 * One playlist.
 *
 * `permissions` is deliberately left unset: Subsonic reports no read/edit split
 * for the connected account, and the SDK is explicit that absent means "the
 * source did not say" while `[]` would mean "asked, and nothing is allowed".
 * Claiming the latter would hide every playlist from the console.
 */
export function mapPlaylist(playlist: SubsonicPlaylist, artworkUrl?: string): ProviderPlaylist | undefined {
    const id = text(playlist.id);
    if (!id) return undefined;

    return {
        id,
        name: text(playlist.name) ?? 'Untitled playlist',
        ...(text(playlist.comment) ? { description: text(playlist.comment) } : {}),
        ...(typeof playlist.songCount === 'number' ? { trackCount: playlist.songCount } : {}),
        ...(artworkUrl ? { artworkUrl } : {}),
    };
}
