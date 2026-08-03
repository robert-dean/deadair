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

interface SpotifyPlaylist {
    id?: string;
    name?: string;
    description?: string;
    images?: SpotifyImage[];
    tracks?: { total?: number };
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

export function mapPlaylist(playlist: SpotifyPlaylist | null | undefined): ProviderPlaylist | undefined {
    if (!playlist?.id || !playlist.name) return undefined;

    return {
        id: playlist.id,
        name: playlist.name,
        description: playlist.description && playlist.description.length > 0 ? playlist.description : undefined,
        trackCount: playlist.tracks?.total,
        artworkUrl: pickArtwork(playlist.images),
    };
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
