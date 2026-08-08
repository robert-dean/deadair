/**
 * The track a listener is hearing right now
 * generated from [NowPlayingTrack](file://./../../../../../apps/api/data/contracts/nowplaying/nowplaying.types.ck#L7)
 */
export interface NowPlayingTrack {
    title: string;
    /** Comma-joined, as a display line rather than a list: this is what a player or a device shows, not something to iterate */
    artist: string;
    album?: string;
    /** The station's own cached cover where there is one, the provider's URL otherwise. Relative values are paths under the API root */
    artworkUrl?: string;
    durationMs?: number;
    /** Unix epoch millis, as observed when the player reported the track started */
    startedAt: number;
    /** Absent when the decoder cannot say. It leads the listener by the encoder and client buffers, so it is a display value and not a schedule */
    remainingMs?: number;
}

/**
 * What the station is playing, for anything that wants to display it
 * generated from [NowPlaying](file://./../../../../../apps/api/data/contracts/nowplaying/nowplaying.types.ck#L17)
 */
export interface NowPlaying {
    /** The station's on-air name */
    station: string;
    /** False means the station is not broadcasting. `track` is absent in that case, which is an ordinary state and not an error */
    onAir: boolean;
    /** How many people are listening right now. Public because it says only what Icecast's own status document already says to anyone who asks, and a station page should not need a session to show it */
    listeners: number;
    track?: NowPlayingTrack;
}
