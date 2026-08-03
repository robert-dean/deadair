/**
 * The `music-provider` kind. A provider declares any subset of the three
 * sub-capabilities below: `catalog` (it can be searched and browsed),
 * `playout` (it can be told to make sound), and `oauth` (it needs a user to
 * authorise it first). Spotify implements all three; a plain SMB library
 * implements only `catalog`.
 *
 * Every shape here is JSON-safe. Durations are integers in milliseconds,
 * never `Date` or `Duration` objects.
 */

/** A track as a provider describes it. Deliberately minimal: this is v1 of a public API. */
export interface ProviderTrack {
    /** Provider-scoped identifier. Opaque to the host. */
    id: string;
    title: string;
    /** Ordered, primary artist first. Empty array if the provider genuinely has none. */
    artists: string[];
    album?: string;
    durationMs?: number;
    /** Recording ISRC, when the provider exposes one. The best cross-provider join key. */
    isrc?: string;
    artworkUrl?: string;
}

export interface ProviderPlaylist {
    id: string;
    name: string;
    description?: string;
    /** Number of tracks, when the provider reports it cheaply. */
    trackCount?: number;
    artworkUrl?: string;
}

/** A playable stream, plus how long the URL stays good for. */
export interface ProviderStream {
    url: string;
    /** Unix epoch millis after which `url` must be re-resolved. */
    expiresAt?: number;
    /** e.g. `audio/mpeg`. */
    mimeType?: string;
}

export interface SearchTracksOptions {
    limit?: number;
    offset?: number;
}

export interface ListPlaylistsOptions {
    limit?: number;
    offset?: number;
}

export interface GetPlaylistTracksOptions {
    limit?: number;
    offset?: number;
}

/** Search and browse. */
export interface MusicProviderCatalog {
    searchTracks(query: string, options?: SearchTracksOptions): Promise<ProviderTrack[]>;

    /** Resolves to `undefined` when the id is unknown to the provider. */
    getTrack(trackId: string): Promise<ProviderTrack | undefined>;

    listPlaylists(options?: ListPlaylistsOptions): Promise<ProviderPlaylist[]>;

    getPlaylistTracks(playlistId: string, options?: GetPlaylistTracksOptions): Promise<ProviderTrack[]>;

    /**
     * Turn a track id into something the host can actually play. Omit when the
     * provider is "steer only" (it plays audio itself and never hands out a
     * URL, e.g. a remote Spotify Connect device).
     */
    resolveStreamUrl?(trackId: string): Promise<ProviderStream | undefined>;
}

export type PlaybackStatus = 'playing' | 'paused' | 'stopped';

export interface PlaybackState {
    status: PlaybackStatus;
    /** The track currently loaded, if any. */
    trackId?: string;
    /** Playhead position in ms. */
    positionMs?: number;
    durationMs?: number;
}

/** Transport control, for providers that own their own audio output. */
export interface MusicProviderPlayout {
    /** Append track ids to the provider's own queue. */
    enqueue(trackIds: string[]): Promise<void>;
    /** Start (or resume). With `trackId`, start that track immediately. */
    play(trackId?: string): Promise<void>;
    pause(): Promise<void>;
    skip(): Promise<void>;
    getPlaybackState(): Promise<PlaybackState>;
}

/**
 * Authorisation-code flow. The host owns the redirect endpoint and calls
 * `handleCallback` with the query parameters it received.
 */
export interface MusicProviderOAuth {
    getAuthorizeUrl(state: string): Promise<string>;
    handleCallback(params: Record<string, string>): Promise<void>;
}

/**
 * Convenience alias for a provider implementing all three sub-capabilities.
 * Implement the individual interfaces instead when you only support some.
 */
export interface MusicProvider extends MusicProviderCatalog, MusicProviderPlayout, MusicProviderOAuth {}
