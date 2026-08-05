/**
 * The plugin playlist to load into the running order
 * generated from [PlayoutPlaylistInput](file://./../../../../../apps/api/data/contracts/playout/playout.types.ck#L7)
 */
export interface PlayoutPlaylistInput {
    /** The plugin playlist to load into the running order */
    pluginId: string;
    playlistId: string;
}

/**
 * One item in the running order, as the console sees it
 * generated from [PlayoutItem](file://./../../../../../apps/api/data/contracts/playout/playout.types.ck#L12)
 */
export interface PlayoutItem {
    /** deadair's own id for this item, not the provider's: a playlist may hold the same track twice */
    id: string;
    pluginId: string;
    /** The track's id in its plugin's id space */
    externalId: string;
    title: string;
    artists: string[];
    durationMs?: number;
}

/**
 * Which rundown item Liquidsoap has just started playing
 * generated from [PlayoutAiredQuery](file://./../../../../../apps/api/data/contracts/playout/playout.types.ck#L35)
 */
export interface PlayoutAiredQuery {
    /** The id the app put on the pushed uri's `annotate:` metadata */
    item: string;
}

/**
 * The shared secret gating the internal playout bridge, in both directions
 * generated from [PlayoutBridgeHeaders](file://./../../../../../apps/api/data/contracts/playout/playout.types.ck#L39)
 */
export interface PlayoutBridgeHeaders {
    /** The shared secret gating the internal playout bridge, in both directions */
    'x-playout-secret': string;
}

/**
 * The shared secret gating the track shim's login route
 * generated from [SpotifyLoginHeaders](file://./../../../../../apps/api/data/contracts/playout/playout.types.ck#L43)
 */
export interface SpotifyLoginHeaders {
    /** The shared secret gating the track shim's login route */
    'x-spotify-login-secret': string;
}

/**
 * A login for the track shim to open its own Spotify session with. Machine-to-machine: this never reaches a browser
 * generated from [SpotifySessionLogin](file://./../../../../../apps/api/data/contracts/playout/playout.types.ck#L47)
 */
export interface SpotifySessionLogin {
    /** The connected account's Spotify id, which is what librespot logs in with */
    username: string;
    accessToken: string;
}

/**
 * What the PLAYER says is airing, which is not the same as what was last handed to it
 * generated from [PlayoutNowPlaying](file://./../../../../../apps/api/data/contracts/playout/playout.types.ck#L21)
 */
export interface PlayoutNowPlaying {
    /** What the PLAYER says is airing, which is not the same as what was last handed to it */
    item: PlayoutItem;
    /** Unix epoch millis, as observed when the player reported it */
    startedAt: number;
    /** The decoder's own countdown, absent when it cannot say. It leads the listener by the encoder and client buffers */
    remainingMs?: number;
}

/**
 * The station's transport, as one reading
 * generated from [PlayoutStatus](file://./../../../../../apps/api/data/contracts/playout/playout.types.ck#L27)
 */
export interface PlayoutStatus {
    /** Whether Liquidsoap's control API is answering at all. False means nothing can air, whatever the running order holds */
    streamUp: boolean;
    /** Same-origin path of the Icecast mount, for a console that wants to monitor what it is driving. A path rather than a URL: the browser reaches Icecast through whatever edge served the SPA, never at the address the app itself uses */
    mountPath: string;
    nowPlaying?: PlayoutNowPlaying;
    /** Waiting here, in order. Excludes what the player already holds */
    upNext: PlayoutItem[];
    /** How many items are waiting in total, of which `upNext` is the head */
    queuedCount: number;
}
