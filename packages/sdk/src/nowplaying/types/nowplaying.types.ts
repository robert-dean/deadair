/**
 * The track a listener is hearing right now
 * generated from [NowPlayingTrack](../../../../../apps/api/data/contracts/nowplaying/nowplaying.types.ck#L7)
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
 * One way to listen to this station right now
 * generated from [NowPlayingMount](../../../../../apps/api/data/contracts/nowplaying/nowplaying.types.ck#L17)
 */
export interface NowPlayingMount {
    /** `hls` is the master playlist rather than an Icecast mount, which is why this enum has an arm `PlayoutMount` does not */
    format: 'mp3' | 'opus' | 'aac' | 'flac' | 'hls';
    /** Same-origin path, leading slash included. A path and not a URL: the station is reached through whatever edge served this answer, never at the address the app itself uses */
    path: string;
    /** Absent for FLAC, which is lossless and has no rate to set, and for HLS, whose rate is the AAC variant's */
    bitrateKbps?: number;
}

/**
 * What the station is playing, for anything that wants to display it
 * generated from [NowPlaying](../../../../../apps/api/data/contracts/nowplaying/nowplaying.types.ck#L23)
 */
export interface NowPlaying {
    /** The station's on-air name */
    station: string;
    /** False means the station is not broadcasting. `track` is absent in that case, which is an ordinary state and not an error */
    onAir: boolean;
    /** How many people are listening right now. Public because it says only what Icecast's own status document already says to anyone who asks, and a station page should not need a session to show it */
    listeners: number;
    /** Every way to listen, MP3 first. Never empty: MP3 has no switch. A format the operator has not switched on is ABSENT rather than present and disabled, because a client asking this wants the mounts that are actually there — and a client that had to find out by connecting to each one would put an audience-gated station on air to do it */
    mounts: NowPlayingMount[];
    track?: NowPlayingTrack;
}
