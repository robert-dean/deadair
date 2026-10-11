import type { ProviderPlaylist, ProviderTrack } from '@deadair/plugin-sdk';
import { ARTWORK_SIZE } from './applemusic.manifest.js';

/**
 * Two upstream shapes, one `ProviderTrack`, and the differences between them are the point.
 *
 * The Apple Music API answers a resource with `id` and an `attributes` object. The public Search API
 * answers a flat row with `trackId`. **Both carry the same catalog id**, which is what makes the keyless
 * mode viable at all: the id the Search API calls `trackId` is the id `setQueue({ song })` plays.
 * Verified against the live player — `1440653203` came out of the Search API and the player reported
 * `Roads`.
 *
 * What only the Apple API has is `isrc`, and it is the reason to configure a key: an ISRC is how a row
 * joins to the same recording from Navidrome or Spotify instead of sitting beside it as a near
 * duplicate. The Search API has no equivalent and nothing can be synthesised, so those rows are
 * honestly thinner rather than filled with a guess.
 */

/** `attributes` of a `songs` resource, narrowed to what is read. */
export interface AppleSongAttributes {
    name?: string;
    artistName?: string;
    albumName?: string;
    durationInMillis?: number;
    isrc?: string;
    releaseDate?: string;
    contentRating?: string;
    artwork?: { url?: string; width?: number; height?: number };
    trackNumber?: number;
    discNumber?: number;
}

export interface AppleSong {
    id?: string;
    attributes?: AppleSongAttributes;
}

/** One row of the public Search API, narrowed to what is read. */
export interface ItunesSong {
    trackId?: number;
    trackName?: string;
    artistName?: string;
    collectionName?: string;
    trackTimeMillis?: number;
    releaseDate?: string;
    trackExplicitness?: string;
    artworkUrl100?: string;
    trackNumber?: number;
    discNumber?: number;
    wrapperType?: string;
    kind?: string;
}

/**
 * The four-digit year of a release, or `undefined`.
 *
 * Both upstreams answer a date rather than a year and the formats differ (`2008-04-01` against a full
 * ISO timestamp), so both are read by taking the leading four digits rather than by parsing a Date —
 * which would also drag a timezone into a field that is a year.
 */
export function yearOf(releaseDate: string | undefined): number | undefined {
    if (typeof releaseDate !== 'string') return undefined;
    const year = Number(releaseDate.slice(0, 4));
    return Number.isInteger(year) && year > 1000 ? year : undefined;
}

/**
 * The station's advisory value, from whichever word this upstream uses.
 *
 * A POSITIVE `clean` matters here rather than being a nicety: `track_sources.advisory` reads null as
 * "the provider did not say, never consent", and a station on `clean-only` starves on providers that
 * never say either way. Apple says on both paths — `contentRating` is `explicit` or `clean`, and the
 * Search API's `trackExplicitness` is `explicit`, `cleaned` or `notExplicit` — and this is the one
 * place those four words become the station's two.
 *
 * `notExplicit` is deliberately NOT mapped to `clean`. It means "this release has no explicit version
 * to be the clean edit of", which is a different statement from "this is the clean edit", and reading
 * it as consent would put an unedited record on a station that asked for clean copies only.
 */
export function advisoryOf(word: string | undefined): 'clean' | 'explicit' | undefined {
    switch (word?.toLowerCase()) {
        case 'explicit':
            return 'explicit';
        case 'clean':
        case 'cleaned':
            return 'clean';
        default:
            return undefined;
    }
}

/** An artwork template (`…/{w}x{h}bb.jpg`) at one fixed size, or a fixed-size URL left alone. */
export function artworkAt(url: string | undefined, size = ARTWORK_SIZE): string | undefined {
    if (typeof url !== 'string' || url === '') return undefined;
    if (url.includes('{w}') || url.includes('{h}')) return url.replace('{w}', String(size)).replace('{h}', String(size));
    // The Search API hands back `100x100bb.jpg` already substituted; asking for the bigger crop of the
    // same asset is a documented rewrite and the alternative is a 100px cover on every row.
    return url.replace(/\/\d+x\d+bb\.(jpg|png)$/, `/${size}x${size}bb.$1`);
}

/** A `songs` resource from the Apple Music API. */
export function trackFromApple(song: AppleSong): ProviderTrack | undefined {
    const attributes = song.attributes;
    if (song.id === undefined || attributes?.name === undefined || attributes.artistName === undefined) return undefined;

    return {
        id: song.id,
        title: attributes.name,
        artists: [attributes.artistName],
        ...(attributes.albumName === undefined ? {} : { album: attributes.albumName }),
        ...(attributes.durationInMillis === undefined ? {} : { durationMs: attributes.durationInMillis }),
        ...(attributes.isrc === undefined ? {} : { isrc: attributes.isrc }),
        ...(yearOf(attributes.releaseDate) === undefined ? {} : { year: yearOf(attributes.releaseDate) }),
        ...(advisoryOf(attributes.contentRating) === undefined ? {} : { advisory: advisoryOf(attributes.contentRating) }),
        ...(artworkAt(attributes.artwork?.url) === undefined ? {} : { artworkUrl: artworkAt(attributes.artwork?.url) }),
    };
}

/** A row from the public Search API. */
export function trackFromItunes(song: ItunesSong): ProviderTrack | undefined {
    // `wrapperType: 'track'` with `kind: 'song'` is the only row that is a record. The same endpoint
    // answers with music videos, podcasts and audiobooks, and a music video's id does not play.
    if (song.wrapperType !== undefined && song.wrapperType !== 'track') return undefined;
    if (song.kind !== undefined && song.kind !== 'song') return undefined;
    if (song.trackId === undefined || song.trackName === undefined || song.artistName === undefined) return undefined;

    return {
        id: String(song.trackId),
        title: song.trackName,
        artists: [song.artistName],
        ...(song.collectionName === undefined ? {} : { album: song.collectionName }),
        ...(song.trackTimeMillis === undefined ? {} : { durationMs: song.trackTimeMillis }),
        ...(yearOf(song.releaseDate) === undefined ? {} : { year: yearOf(song.releaseDate) }),
        ...(advisoryOf(song.trackExplicitness) === undefined ? {} : { advisory: advisoryOf(song.trackExplicitness) }),
        ...(artworkAt(song.artworkUrl100) === undefined ? {} : { artworkUrl: artworkAt(song.artworkUrl100) }),
        // No `isrc`, and nothing to put there. See the note at the top of this file.
    };
}

/** A `playlists` resource from the Apple Music API. */
export function playlistFromApple(playlist: {
    id?: string;
    attributes?: { name?: string; curatorName?: string; trackCount?: number };
}): ProviderPlaylist | undefined {
    if (playlist.id === undefined || playlist.attributes?.name === undefined) return undefined;
    return {
        id: playlist.id,
        name: playlist.attributes.name,
        ...(playlist.attributes.trackCount === undefined ? {} : { trackCount: playlist.attributes.trackCount }),
        // Everything reachable with a developer token alone is Apple's own editorial, never the
        // operator's: a personal library needs a Music User Token this plugin does not hold. Saying so
        // is what lets the console fold them away from what the operator actually chose.
        madeByProvider: true,
    };
}

/** An Apple Music playlist id: `pl.` and hex for Apple's own, `pl.u-` and more for one a listener shared. */
const APPLE_PLAYLIST_ID = /^pl\.(?:u-)?[A-Za-z0-9]+$/;

/**
 * The playlist an Apple Music link names, as the share button writes it:
 * `https://music.apple.com/us/playlist/todays-hits/pl.f4d106fed2bd41149aaacabb233eb5eb`, with or without
 * the name segment and a `?l=` query, an embed link, or an old `itunes.apple.com` link whose id is
 * written `idpl.…`. Anything else is not ours, an album or a song on the same host included, because the
 * first provider to claim a link wins it.
 *
 * The storefront in the path is deliberately dropped. The plugin reads its own configured storefront,
 * and an id that carried the link's would not be one `listPlaylists` ever answers.
 */
export function applePlaylistIdFromUrl(url: string): string | undefined {
    let parsed: URL;
    try {
        parsed = new URL(url.trim());
    } catch {
        return undefined;
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined;
    if (!['music.apple.com', 'embed.music.apple.com', 'geo.music.apple.com', 'itunes.apple.com'].includes(parsed.hostname)) return undefined;

    const match = /^\/(?:[a-z]{2}\/)?playlist\/(?:[^/]+\/)?(?:id)?([^/]+)\/?$/i.exec(parsed.pathname);
    const id = match?.[1];
    return id !== undefined && APPLE_PLAYLIST_ID.test(id) ? id : undefined;
}

/**
 * Whether a search result honours the filters the caller asked for.
 *
 * Applied here because neither upstream can: Apple's search takes no year filter and the Search API
 * takes none either. The SDK's rule is that a filter you cannot apply means you have nothing to offer
 * for that search, so this drops what does not match rather than answering as though the filter had not
 * been asked for — the caller merges several providers into one list and nothing marks which rows
 * honoured it.
 *
 * Year only, because `SearchTracksOptions` is `limit`, `offset`, `yearFrom` and `yearTo` and nothing
 * else. Both upstreams do carry a genre word, and it is deliberately not read: the station's genre lives
 * on `tracks.genre` and is settled by enrichment rather than by whichever provider imported the row, so
 * a genre here would be a field nobody asked for on a contract that has no place to put it.
 */
export function matchesFilters(track: ProviderTrack, filters: { yearFrom?: number; yearTo?: number }): boolean {
    if (filters.yearFrom !== undefined && (track.year === undefined || track.year < filters.yearFrom)) return false;
    if (filters.yearTo !== undefined && (track.year === undefined || track.year > filters.yearTo)) return false;
    return true;
}
