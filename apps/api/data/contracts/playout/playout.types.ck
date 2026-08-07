options {
    keys: {
        area: playout
    }
}

contract PlayoutPlaylistInput: { # The plugin playlist to load into the running order
    pluginId: string(min=1, max=200)
    playlistId: string(min=1, max=400)
}

contract PlayoutItem: { # One item in the running order, as the console sees it
    id: string(min=1, max=100) # deadair's own id for this item, not the provider's: a playlist may hold the same track twice
    pluginId: string(min=1, max=200)
    externalId: string(min=1, max=400) # The track's id in its plugin's id space
    title: string(min=1, max=400)
    artists: array(string(min=1, max=200))
    durationMs?: int(min=0) # Integer milliseconds. Deliberately not the `duration` scalar, which is a Luxon `Duration` over an ISO-8601 string
}

contract PlayoutNowPlaying: { # What the PLAYER says is airing, which is not the same as what was last handed to it
    item: PlayoutItem
    startedAt: int(min=0) # Unix epoch millis, as observed when the player reported it
    remainingMs?: int(min=0) # The decoder's own countdown, absent when it cannot say. It leads the listener by the encoder and client buffers
}

contract PlayoutStatus: { # The station's transport, as one reading
    streamUp: boolean # Whether Liquidsoap's control API is answering at all. False means nothing can air, whatever the running order holds
    onAir: boolean # Whether the station is actually broadcasting. deadair holds the mount on a lease it renews only while it has a programme, so a reachable stream with nothing to play is up and NOT on air: it is connected, and airing silence
    mountPath: string(min=1, max=200) # Same-origin path of the Icecast mount, for a console that wants to monitor what it is driving. A path rather than a URL: the browser reaches Icecast through whatever edge served the SPA, never at the address the app itself uses
    nowPlaying?: PlayoutNowPlaying
    upNext: array(PlayoutItem) # Waiting here, in order. Excludes what the player already holds
    queuedCount: int(min=0) # How many items are waiting in total, of which `upNext` is the head
}

contract PlayoutAiredQuery: { # Which rundown item Liquidsoap has just started playing
    item: string(min=1, max=100) # The id the app put on the pushed uri's `annotate:` metadata
}

contract PlayoutBridgeHeaders: { # The shared secret gating the internal playout bridge, in both directions
    x-playout-secret: string(min=1, max=200)
}

contract SpotifyLoginHeaders: { # The shared secret gating the track shim's login route
    x-spotify-login-secret: string(min=1, max=200)
}

contract SpotifySessionLogin: { # A login for the track shim to open its own Spotify session with. Machine-to-machine: this never reaches a browser
    username: string(min=1, max=200) # The connected account's Spotify id, which is what librespot logs in with
    accessToken: string(min=1, max=4000)
}
