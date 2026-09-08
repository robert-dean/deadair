options {
    keys: {
        area: nowplaying
    }
}

contract NowPlayingTrack: { # The track a listener is hearing right now
    title: string(min=1, max=400)
    artist: string(max=400) # Comma-joined, as a display line rather than a list: this is what a player or a device shows, not something to iterate
    album?: string(max=400)
    artworkUrl?: string(max=2000) # The station's own cached cover where there is one, the provider's URL otherwise. Relative values are paths under the API root
    durationMs?: int(min=0)
    startedAt: int(min=0) # Unix epoch millis, as observed when the player reported the track started
    remainingMs?: int(min=0) # Absent when the decoder cannot say. It leads the listener by the encoder and client buffers, so it is a display value and not a schedule
}

contract NowPlayingMount: { # One way to listen to this station right now
    format: enum(mp3, opus, aac, flac, hls) # `hls` is the master playlist rather than an Icecast mount, which is why this enum has an arm `PlayoutMount` does not
    path: string(min=1, max=200) # Same-origin path, leading slash included. A path and not a URL: the station is reached through whatever edge served this answer, never at the address the app itself uses
    bitrateKbps?: int(min=1) # Absent for FLAC, which is lossless and has no rate to set, and for HLS, whose rate is the AAC variant's
}

contract NowPlaying: { # What the station is playing, for anything that wants to display it
    station: string(max=200) # The station's on-air name
    onAir: boolean # False means the station is not broadcasting. `track` is absent in that case, which is an ordinary state and not an error
    listeners: int(min=0) # How many people are listening right now. Public because it says only what Icecast's own status document already says to anyone who asks, and a station page should not need a session to show it
    mounts: array(NowPlayingMount) # Every way to listen, MP3 first. Never empty: MP3 has no switch. A format the operator has not switched on is ABSENT rather than present and disabled, because a client asking this wants the mounts that are actually there — and a client that had to find out by connecting to each one would put an audience-gated station on air to do it
    track?: NowPlayingTrack
}
