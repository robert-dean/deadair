/**
 * The `music-provider` kind. A provider declares any subset of the four
 * sub-capabilities below: `catalog` (it can be searched and browsed), `stream`
 * (it can get the station audio to play), `steer` (it owns its own audio output
 * and takes instructions), and `oauth` (it needs a user to authorise it first).
 * Spotify declares all four; a plain SMB library declares `catalog` and
 * `stream`.
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
    /**
     * How well known the record is, 0 to 100, when the provider has an opinion.
     *
     * A RANKING and not a fact: providers compute it differently and none of them says how, so the
     * only thing it may be used for is ordering rows from the same search against each other. Never
     * compare it across providers, never show it to a listener, and never gate on a threshold.
     *
     * Optional because most sources have nothing like it — a personal library knows what you own,
     * not what the world plays — and absent must read as "no opinion" rather than as unpopular, or
     * a station with one ranked provider and one unranked would bury the unranked one's whole
     * catalogue.
     *
     * It exists because of a specific failure: asked for "popular rap songs from the USA", the
     * model browsed a genre, got two dozen obscure records back in the provider's own order, and
     * named them. Nothing in the chain could tell a hit from an unknown, so the brief was
     * unservable however well the model behaved. See `CatalogSearchTool`.
     */
    popularity?: number;
}

/**
 * What a source will let the connected account do with one playlist's items.
 *
 * Both values are item-scoped, mirroring the endpoint pair they describe
 * (Spotify's `GET` and `PUT /playlists/{id}/items`). Neither says anything
 * about the playlist's own name or description: on Spotify a collaborator may
 * change the items and not the details.
 */
export type ProviderPlaylistPermission =
    /** The source will return this playlist's items. */
    | 'read'
    /** The source will permit modifying this playlist's items. */
    | 'edit';

export interface ProviderPlaylist {
    id: string;
    name: string;
    description?: string;
    /** Number of tracks, when the provider reports it cheaply. */
    trackCount?: number;
    artworkUrl?: string;
    /**
     * What the SOURCE permits for the connected account on this playlist, so
     * the host can avoid offering a call that cannot succeed. Not deadair's own
     * authorization for the requesting actor, which is a separate question
     * asked of the permission model, and not a claim that the plugin implements
     * the action either, which is what the manifest's capabilities declare. All
     * three have to hold before an action is worth offering.
     *
     * Absent and empty mean different things, and the difference matters:
     *
     * - `undefined` — the source did not say. Providers with no such split (most
     *   of them) leave it alone, and a host must read this as "no reason to
     *   think otherwise" rather than hiding the playlist.
     * - `[]` — the source was asked and permits nothing.
     *
     * Spotify populates it because a listing there mixes playlists the account
     * owns with playlists it merely follows, and since the February 2026 Web
     * API changes only the owned half can be read at all.
     */
    permissions?: ProviderPlaylistPermission[];
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
    /**
     * Narrow the search to a style, as a plain word the caller chose (`jazz`, `krautrock`).
     *
     * Structured rather than folded into `query` because every upstream spells this differently, and
     * `query` is free text going straight at a title and an artist name. A station asked for "jazz
     * club hits" that searches for those words gets records with those words in the TITLE, which is
     * the failure this field exists to fix; the style is a different axis and has to be sent as one.
     *
     * How it is expressed is the plugin's business, exactly as a voice id is: the host never learns
     * one upstream's filter dialect. See {@link searchTracks} for what a provider that cannot filter
     * must do about it.
     */
    genre?: string;
    /**
     * Narrow to records released in a period, inclusive, as four-digit years.
     *
     * Either end may stand alone: `yearFrom` with no `yearTo` is "this year onwards".
     */
    yearFrom?: number;
    yearTo?: number;
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
    /**
     * Records matching `query`, narrowed by whatever {@link SearchTracksOptions} carries.
     *
     * **A filter you cannot apply means you have nothing to offer for that search — answer `[]`.**
     * Never ignore one and answer as though it had not been asked for. The caller merges several
     * providers into one list and cannot tell which rows honoured a filter, so a provider that
     * quietly drops `genre` does not degrade the answer, it poisons it: the station asked for jazz
     * from 1955 and is handed something else with nothing marking it. Declining costs the caller one
     * provider's share of a result set it already treats as partial, which is the cheaper mistake by
     * a wide margin. This is the same reasoning `ProviderTrackLookup` is strict for — a near miss
     * here does not raise an error, it airs the wrong record.
     *
     * `limit` is a TOTAL, not a page size. Page internally if the upstream's own ceiling is lower.
     */
    searchTracks(query: string, options?: SearchTracksOptions): Promise<ProviderTrack[]>;

    /** Resolves to `undefined` when the id is unknown to the provider. */
    getTrack(trackId: string): Promise<ProviderTrack | undefined>;

    listPlaylists(options?: ListPlaylistsOptions): Promise<ProviderPlaylist[]>;

    getPlaylistTracks(playlistId: string, options?: GetPlaylistTracksOptions): Promise<ProviderTrack[]>;
}

/**
 * Getting the station actual audio: one method, because it is one job.
 *
 * A provider that cannot answer it plays its own audio and never hands anything
 * over, which is what "steer only" means (a remote Spotify Connect device, say).
 *
 * How the audio reaches the player is the provider's business, not the caller's.
 * Most mint a URL out of their own head. A provider whose audio is reachable
 * only to a process speaking a protocol it does not — Spotify's, whose tracks
 * come off the CDN encrypted — lends the station's fetcher a login through
 * `host.trackFetcher` and returns the URL that comes back. Both answer here.
 */
export interface MusicProviderStream {
    /**
     * Turn a track id into something the host can actually play: a complete URL
     * that carries its own authentication, because the player fetches it with no
     * headers from us.
     *
     * Optional only so a "steer only" provider can leave it out. Resolves to
     * `undefined` when the provider is not connected yet, or when this station
     * has nothing that can serve the track: the host reads that as "not
     * available", skips the item, and holds nothing against the plugin.
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

/**
 * Transport control, for providers that own their own audio output: deadair
 * tells them what to do rather than playing anything itself.
 *
 * Named for what the plugin is asked to do, not for what the station calls the
 * job. deadair's own `playout` module is the other end of this — it owns the
 * running order and drives the player — so a capability by that name would have
 * meant the opposite thing to anyone reading both.
 */
export interface MusicProviderSteer {
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
 * Convenience alias for a provider implementing every sub-capability.
 * Implement the individual interfaces instead when you only support some.
 */
export interface MusicProvider extends MusicProviderCatalog, MusicProviderStream, MusicProviderSteer, MusicProviderOAuth {}
