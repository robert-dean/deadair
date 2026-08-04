import type { MaxInt } from '@spotify/web-api-ts-sdk';
import type { PlaybackState, ProviderPlaylist, ProviderTrack } from '@deadair/plugin-sdk';

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
        importable: playlistImportable(playlist, currentUserId),
    };
}

/**
 * Whether Spotify will hand over this playlist's tracks.
 *
 * Since February 2026 that is limited to playlists the user owns or
 * collaborates on; everything else answers 403 by design. A listing is full of
 * the other kind, because `GET /me/playlists` returns what the user *follows*:
 * editorial playlists, Daily Mix, Discover Weekly, friends' playlists. Without
 * this they all render as importable and 403 the moment one is opened.
 *
 * `collaborative` counts as readable even though it only says the playlist
 * accepts collaborators rather than that this user is one. That errs
 * permissive on purpose: the cost of being wrong is one handled 403, whereas
 * being wrong the other way silently hides a playlist the user can really
 * import. Answers `undefined` rather than guessing when the owner is unknown,
 * which keeps a missing `owner` from turning into "unimportable".
 */
function playlistImportable(playlist: SpotifyPlaylist, currentUserId?: string): boolean | undefined {
    if (playlist.collaborative) return true;
    if (!currentUserId || !playlist.owner?.id) return undefined;
    return playlist.owner.id === currentUserId;
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
 * This is the single cast site; nothing else in the plugin casts to `MaxInt<50>`.
 */
export function clampLimit(limit: number | undefined): MaxInt<50> | undefined {
    if (limit === undefined) return undefined;
    const clamped = Math.min(50, Math.max(1, Math.trunc(limit)));
    return clamped as MaxInt<50>;
}
