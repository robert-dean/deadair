/**
 * The plugin playlist to load into the running order
 * generated from [PlayoutPlaylistInput](file://./../../../../../apps/api/data/contracts/playout/playout.types.ck#L7)
 */
export interface PlayoutPlaylistInput {
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
    /** Integer milliseconds. Deliberately not the `duration` scalar, which is a Luxon `Duration` over an ISO-8601 string */
    durationMs?: number;
    album?: string;
    /** The locally cached cover where there is one, the provider's URL otherwise */
    artworkUrl?: string;
    /** First release year, when the catalog knows one */
    year?: number;
    /** The canonical `deadair.tracks` id, when this item is a track the catalog holds. Absent for anything the catalog has never seen */
    trackId?: string;
}

/**
 * Which rundown item Liquidsoap has just started playing
 * generated from [PlayoutAiredQuery](file://./../../../../../apps/api/data/contracts/playout/playout.types.ck#L40)
 */
export interface PlayoutAiredQuery {
    /** The id the app put on the pushed uri's `annotate:` metadata */
    item: string;
}

/**
 * The shared secret gating the internal playout bridge, in both directions
 * generated from [PlayoutBridgeHeaders](file://./../../../../../apps/api/data/contracts/playout/playout.types.ck#L44)
 */
export interface PlayoutBridgeHeaders {
    'x-playout-secret': string;
}

/**
 * What the PLAYER says is airing, which is not the same as what was last handed to it
 * generated from [PlayoutNowPlaying](file://./../../../../../apps/api/data/contracts/playout/playout.types.ck#L25)
 */
export interface PlayoutNowPlaying {
    item: PlayoutItem;
    /** Unix epoch millis, as observed when the player reported it */
    startedAt: number;
    /** The decoder's own countdown, absent when it cannot say. It leads the listener by the encoder and client buffers */
    remainingMs?: number;
}

/**
 * The station's transport, as one reading
 * generated from [PlayoutStatus](file://./../../../../../apps/api/data/contracts/playout/playout.types.ck#L31)
 */
export interface PlayoutStatus {
    /** Whether Liquidsoap's control API is answering at all. False means nothing can air, whatever the running order holds */
    streamUp: boolean;
    /** Whether the station is actually broadcasting. deadair holds the mount on a lease it renews only while it has a programme, so a reachable stream with nothing to play is up and NOT on air: it is connected, and airing silence */
    onAir: boolean;
    /** Same-origin path of the Icecast mount, for a console that wants to monitor what it is driving. A path rather than a URL: the browser reaches Icecast through whatever edge served the SPA, never at the address the app itself uses */
    mountPath: string;
    nowPlaying?: PlayoutNowPlaying;
    /** Waiting here, in order. Excludes what the player already holds */
    upNext: PlayoutItem[];
    /** How many items are waiting in total, of which `upNext` is the head */
    queuedCount: number;
}
