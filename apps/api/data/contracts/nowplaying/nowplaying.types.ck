options {
    keys: {
        area: nowplaying
    }
}

contract NowPlayingTrack: { # What a listener is hearing right now: a record, or the station talking
    kind: enum(record, break) = record # `record` is music. `break` is the station speaking on its own between two records (an ident, a bulletin, a talk break), with `artist` empty and `title` the break's own label. A presenter talking over the start of a record is not a break: the record is what is on air, and it stays `record`. Absent means `record`, which is all a station older than this field ever reported
    title: string(min=1, max=400)
    artist: string(max=400) # Comma-joined, as a display line rather than a list: this is what a player or a device shows, not something to iterate. Empty for a `break`
    album?: string(max=400)
    artworkUrl?: string(max=2000) # The station's own cached cover, as a path under the API root (`art/...`). Absent while the station does not yet hold the cover, which a player answers with the station's logo; never a provider's URL
    durationMs?: int(min=0)
    startedAt: int(min=0) # Unix epoch millis, as observed when the player reported the track started
    remainingMs?: int(min=0) # Absent when the decoder cannot say. It leads the listener by the encoder and client buffers, so it is a display value and not a schedule
}

contract NowPlayingMount: { # One way to listen to this station right now
    format: enum(mp3, opus, aac, flac, hls) # `hls` is the master playlist rather than an Icecast mount, which is why this enum has an arm `PlayoutMount` does not
    path: string(min=1, max=200) # Same-origin path, leading slash included. A path and not a URL: the station is reached through whatever edge served this answer, never at the address the app itself uses
    bitrateKbps?: int(min=1) # Absent for FLAC, which is lossless and has no rate to set, and for HLS, whose rate is the AAC variant's
}

contract NowPlayingShow: { # The programme on air, as a listener would be told it
    name: string(max=200) # What this broadcast is called. It changes the moment the station changes programme, which can be one record before the new programme's first record is heard: a changeover never cuts a listener off mid-record
    host?: string(max=200) # Who is presenting, by the name they go by on air. Absent when there is no name to give: no persona on air with one, and no station-wide presenter name set. Never the persona's console label
    hostArtUrl?: string(max=2000) # A picture of whoever is presenting, when the operator gave their persona one. A path under the API root, like a cover's. Absent for a persona with no picture, which a player answers by showing the record's cover as before
}

contract NowPlaying: { # What the station is playing, for anything that wants to display it
    station: string(max=200) # The station's on-air name
    onAir: boolean # False means the station is not broadcasting. `track` is absent in that case, which is an ordinary state and not an error
    listeners: int(min=0) # How many people are listening right now. Public because it says only what Icecast's own status document already says to anyone who asks, and a station page should not need a session to show it
    mounts: array(NowPlayingMount) # Every way to listen, MP3 first. Never empty: MP3 has no switch. A format the operator has not switched on is ABSENT rather than present and disabled, because a client asking this wants the mounts that are actually there — and a client that had to find out by connecting to each one would put an audience-gated station on air to do it
    show?: NowPlayingShow # Present whenever `track` is and the station has said what programme it belongs to. Absent off air, and while a station warming up has nothing airing yet
    track?: NowPlayingTrack
}

contract NowPlayingLyrics: { # The words of whatever record is on air, and where it is in them
    onAir: boolean # False when nothing is airing, with everything else absent
    trackId?: uuid # The catalog record on air. Absent while the station is talking, and for a record the catalog has never held
    startedAt?: int(min=0) # Unix epoch millis when the record went on air, the same instant `/nowplaying` reports. Match on it before pairing these lyrics with a `/nowplaying` reading
    cueInMs?: int(min=0) # Where in the file the record started playing. Absent means the top of the file
    cueOutMs?: int(min=0) # Where in the file the record stops playing. A line's `atMs` counts from the top of the file and the decoder's `remainingMs` counts down to this point, so the position to highlight is this (or the record's `durationMs` when absent) minus `remainingMs`. Absent for a record nothing has measured, which plays to the end of the file
    lyrics?: TrackLyrics # The station's answer for that record. Absent with no `trackId`
}
