import type { MaxInt } from '@spotify/web-api-ts-sdk';
import type { PlaybackState, ProviderPlaylist, ProviderPlaylistPermission, ProviderTrack, SearchTracksOptions } from '@deadair/plugin-sdk';

/**
 * The SDK's own `Track` / `PlaylistedTrack` / `PlaybackState` types declare their
 * fields non-optional, but Spotify's responses really do contain nulls, episodes and
 * partial payloads. These locally narrowed, all-optional shapes are the defensive
 * input the mapping functions below actually rely on.
 */
interface SpotifyImage {
    url?: string;
    width?: number;
    height?: number;
}

interface SpotifyArtist {
    name?: string;
}

interface SpotifyAlbum {
    name?: string;
    images?: SpotifyImage[];
}

interface SpotifyTrack {
    id?: string;
    name?: string;
    artists?: SpotifyArtist[];
    album?: SpotifyAlbum;
    duration_ms?: number;
    external_ids?: { isrc?: string };
}

/**
 * `items` is the February 2026 name for what used to be `tracks`; the old key
 * is still populated but documented as deprecated, so both are read and
 * `items` wins. Same story one level down in {@link SpotifyPlaylistedItem}.
 */
interface SpotifyPlaylist {
    id?: string;
    name?: string;
    description?: string;
    images?: SpotifyImage[];
    items?: { total?: number };
    tracks?: { total?: number };
    owner?: { id?: string };
    collaborative?: boolean;
}

/**
 * One row of a playlist listing. `track` is the pre-2026 key for `item` and is
 * marked deprecated on the current reference; reading `item` first means the
 * day `track` stops being sent is a non-event.
 *
 * This one is worth being careful about: `mapTrack` answers `undefined` for
 * anything falsy and `toProviderTracks` drops those without complaint, so
 * reading only the key that went away would not throw. It would quietly hand
 * back empty playlists.
 */
export interface SpotifyPlaylistedItem {
    item?: SpotifyTrack | null;
    track?: SpotifyTrack | null;
}

interface SpotifyPlaybackStateItem {
    id?: string;
    duration_ms?: number;
}

interface SpotifyPlaybackState {
    is_playing?: boolean;
    progress_ms?: number;
    item?: SpotifyPlaybackStateItem;
}

/** Spotify returns images widest-first; the first one is the best artwork available. */
function pickArtwork(images?: SpotifyImage[]): string | undefined {
    return images?.[0]?.url;
}

/**
 * A Spotify item is only a usable {@link ProviderTrack} once it has an id and
 * a title. Playlists can contain nulls (removed tracks) and episodes, so this
 * returns `undefined` rather than fabricating a half-empty track.
 */
export function mapTrack(track: SpotifyTrack | null | undefined): ProviderTrack | undefined {
    if (!track?.id || !track.name) return undefined;

    return {
        id: track.id,
        title: track.name,
        artists: (track.artists ?? []).map(artist => artist.name).filter((name): name is string => typeof name === 'string' && name.length > 0),
        album: track.album?.name,
        durationMs: track.duration_ms,
        isrc: track.external_ids?.isrc,
        artworkUrl: pickArtwork(track.album?.images),
    };
}

export function mapPlaylist(playlist: SpotifyPlaylist | null | undefined, currentUserId?: string): ProviderPlaylist | undefined {
    if (!playlist?.id || !playlist.name) return undefined;

    return {
        id: playlist.id,
        name: playlist.name,
        description: playlist.description && playlist.description.length > 0 ? playlist.description : undefined,
        trackCount: playlist.items?.total ?? playlist.tracks?.total,
        artworkUrl: pickArtwork(playlist.images),
        permissions: playlistPermissions(playlist, currentUserId),
    };
}

/**
 * What Spotify will let this account do with the playlist's items.
 *
 * Since February 2026 both reading and modifying items are limited to playlists
 * the account owns or collaborates on; everything else answers 403 by design. A
 * listing is full of the other kind, because `GET /me/playlists` returns what
 * the account *follows*: editorial playlists, Daily Mix, Discover Weekly,
 * friends' playlists. Without this they all render as usable and 403 the moment
 * one is opened.
 *
 * `read` and `edit` therefore travel together here. That is a fact about
 * Spotify's rules rather than a rule other providers must follow, and the two
 * are separate values precisely so a provider that splits them can say so.
 *
 * `collaborative` counts even though it only says the playlist accepts
 * collaborators rather than that this account is one. That errs permissive on
 * purpose: the cost of being wrong is one handled 403, whereas being wrong the
 * other way silently hides a playlist the account can really use.
 *
 * Answers `undefined`, not `[]`, when the owner or the account id is unknown.
 * Those are different claims: `[]` says Spotify permits nothing, while
 * `undefined` says we never found out, and a host that conflates them hides the
 * whole library the first time the profile call blips.
 */
function playlistPermissions(playlist: SpotifyPlaylist, currentUserId?: string): ProviderPlaylistPermission[] | undefined {
    if (playlist.collaborative) return ['read', 'edit'];
    if (!currentUserId || !playlist.owner?.id) return undefined;
    return playlist.owner.id === currentUserId ? ['read', 'edit'] : [];
}

/**
 * Maps a playback snapshot to a {@link PlaybackState}. The 204-no-content case (nothing
 * playing) deserializes to `null` on the SDK side, so the caller handles that before
 * reaching here; this stays total for a missing/undefined `item` on whatever it is
 * given.
 */
export function mapPlaybackState(state: SpotifyPlaybackState): PlaybackState {
    return {
        status: state.is_playing ? 'playing' : 'paused',
        trackId: state.item?.id,
        positionMs: state.progress_ms,
        durationMs: state.item?.duration_ms,
    };
}

/**
 * The SDK types `limit` as `MaxInt<50>` — a 0-50 numeric union, not `number` — so any
 * caller-supplied limit has to be clamped and cast before it can be passed through.
 * This and {@link clampSearchLimit} are the only cast sites; nothing else in the
 * plugin casts to `MaxInt<50>`.
 *
 * 50 is right for the paged endpoints this plugin reads — `/me/playlists`,
 * `/playlists/{id}/items` — and wrong for search. See {@link clampSearchLimit}.
 */
export function clampLimit(limit: number | undefined): MaxInt<50> | undefined {
    if (limit === undefined) return undefined;
    const clamped = Math.min(50, Math.max(1, Math.trunc(limit)));
    return clamped as MaxInt<50>;
}

/**
 * Search's own ceiling, which February 2026 cut to 10 while leaving every other
 * paged endpoint at 50. Asking for 11 is a 400, not a silent trim.
 */
const SEARCH_LIMIT_MAX = 10;

/**
 * What search asks for when the caller does not say.
 *
 * Deliberately NOT "send nothing and take Spotify's default": that default went
 * from 20 to 5 in the same round, silently, and the depth of a search is how much
 * of the library a writer is allowed to name. Pinning it here means the next time
 * Spotify moves the default this plugin does not quietly follow.
 */
const SEARCH_LIMIT_DEFAULT = SEARCH_LIMIT_MAX;

/** Search stops paging at 1000, unlike `/me/playlists`, which goes to 100,000. */
export const SEARCH_OFFSET_MAX = 1000;

/**
 * The most records one {@link MusicProviderCatalog.searchTracks} call will collect, across pages.
 *
 * A bound on the paging rather than on the answer. `SEARCH_LIMIT_MAX` being 10 means a caller asking
 * for 25 costs three round trips, and without a ceiling here a caller asking for 500 would quietly
 * spend fifty — on an API whose rate limit is the one thing this plugin is most careful about. Fifty
 * is twice the deepest ask the station actually makes (`CatalogSearchTool.MAX_RESULTS`), so it is a
 * runaway guard rather than a working limit.
 */
const SEARCH_TOTAL_MAX = 50;

/**
 * {@link clampLimit} for `GET /search`, which since February 2026 caps `limit` at
 * 10 with a default of 5.
 *
 * Separate from `clampLimit` rather than replacing it: lowering the shared clamp
 * would halve playlist paging for a rule that applies to one endpoint. Returns
 * `MaxInt<50>` because that is still how the SDK types the parameter; the value
 * inside it is never above {@link SEARCH_LIMIT_MAX}.
 */
export function clampSearchLimit(limit: number | undefined): MaxInt<50> {
    if (limit === undefined) return SEARCH_LIMIT_DEFAULT as MaxInt<50>;
    const clamped = Math.min(SEARCH_LIMIT_MAX, Math.max(1, Math.trunc(limit)));
    return clamped as MaxInt<50>;
}

/**
 * The caller's free text plus Spotify's own field filters, as one `q`.
 *
 * Spotify's search is a text match against titles and artist names, so a station's brief handed
 * straight over comes back as records with those words in the title. `genre:` and `year:` are a
 * different axis and the only way to ask the question the caller meant. The SDK keeps them
 * structured and provider-neutral precisely so this translation lives here, in the one plugin that
 * knows this dialect — the host never learns it, the same way it never learns a speech engine's
 * knobs.
 *
 * Values are quoted when they contain a space, because `genre:new wave` parses as a genre of `new`
 * and a stray term `wave`. A year range is `year:1955-1965`, and either end alone is `year:1955`
 * (Spotify reads a bare year as that year, so an open-ended `yearFrom` is expressed by ranging it to
 * the other bound rather than left dangling).
 */
export function buildSearchQuery(query: string, options: SearchTracksOptions | undefined): string {
    const parts = [query.trim()];

    const genre = options?.genre?.trim();
    if (genre) parts.push(`genre:${quoteIfNeeded(genre)}`);

    const from = year(options?.yearFrom);
    const to = year(options?.yearTo);
    if (from !== undefined && to !== undefined) parts.push(`year:${Math.min(from, to)}-${Math.max(from, to)}`);
    else if (from !== undefined) parts.push(`year:${from}-${YEAR_MAX}`);
    else if (to !== undefined) parts.push(`year:${YEAR_MIN}-${to}`);

    return parts.filter(part => part.length > 0).join(' ');
}

/** The bounds an open-ended year range is closed against. Recorded music starts well inside these. */
const YEAR_MIN = 1900;
const YEAR_MAX = 2100;

/** A usable four-digit year, or nothing. A caller's zero or NaN is not a filter. */
function year(value: number | undefined): number | undefined {
    if (value === undefined || !Number.isFinite(value)) return undefined;
    const rounded = Math.trunc(value);
    return rounded >= YEAR_MIN && rounded <= YEAR_MAX ? rounded : undefined;
}

/** A double quote is what Spotify's parser takes, and a value carrying one cannot be quoted at all. */
const quoteIfNeeded = (value: string): string => (value.includes(' ') && !value.includes('"') ? `"${value}"` : value.replace(/"/g, ''));

/** Holds a caller's search offset inside the window Spotify will page over. */
export function clampSearchOffset(offset: number | undefined): number | undefined {
    if (offset === undefined) return undefined;
    return Math.min(SEARCH_OFFSET_MAX, Math.max(0, Math.trunc(offset)));
}

/**
 * How many records a search should collect in TOTAL, across however many requests that takes.
 *
 * The companion to {@link clampSearchLimit} and not a replacement for it: that one is what a single
 * request may ask Spotify for, this is what the caller asked the plugin for. They were the same
 * number for as long as `searchTracks` made one request, and the consequence was that a caller
 * asking for 25 was silently answered with 10 — with nothing in the result saying it had been
 * trimmed, since a short page is also what a genuinely thin search looks like.
 *
 * Undefined means {@link SEARCH_LIMIT_MAX}: one request, which is what a caller that named no limit
 * used to get and the cheapest thing to do for one that does not care.
 */
export function clampSearchTotal(limit: number | undefined): number {
    if (limit === undefined) return SEARCH_LIMIT_MAX;
    return Math.min(SEARCH_TOTAL_MAX, Math.max(1, Math.trunc(limit)));
}
