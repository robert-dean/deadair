/**
 * What a listener is hearing right now: a record, or the station talking
 * generated from [NowPlayingTrack](../../../../../apps/api/data/contracts/nowplaying/nowplaying.types.ck#L7)
 */
export interface NowPlayingTrack {
    /** `record` is music. `break` is the station speaking on its own between two records (an ident, a bulletin, a talk break), with `artist` empty and `title` the break's own label. A presenter talking over the start of a record is not a break: the record is what is on air, and it stays `record`. Absent means `record`, which is all a station older than this field ever reported */
    kind?: 'record' | 'break';
    title: string;
    /** Comma-joined, as a display line rather than a list: this is what a player or a device shows, not something to iterate. Empty for a `break` */
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
 * generated from [NowPlayingMount](../../../../../apps/api/data/contracts/nowplaying/nowplaying.types.ck#L18)
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
 * The programme on air, as a listener would be told it
 * generated from [NowPlayingShow](../../../../../apps/api/data/contracts/nowplaying/nowplaying.types.ck#L24)
 */
export interface NowPlayingShow {
    /** What this broadcast is called. It changes the moment the station changes programme, which can be one record before the new programme's first record is heard: a changeover never cuts a listener off mid-record */
    name: string;
    /** Who is presenting, by the name they go by on air. Absent when there is no name to give: no persona on air with one, and no station-wide presenter name set. Never the persona's console label */
    host?: string;
}

/**
 * What the station is playing, for anything that wants to display it
 * generated from [NowPlaying](../../../../../apps/api/data/contracts/nowplaying/nowplaying.types.ck#L29)
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
    /** Present whenever `track` is and the station has said what programme it belongs to. Absent off air, and while a station warming up has nothing airing yet */
    show?: NowPlayingShow;
    track?: NowPlayingTrack;
}
