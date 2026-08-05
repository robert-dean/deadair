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
    durationMs?: number
}

contract PlayoutNowPlaying: { # What the PLAYER says is airing, which is not the same as what was last handed to it
    item: PlayoutItem
    startedAt: number # Unix epoch millis, as observed when the player reported it
    remainingMs?: number # The decoder's own countdown, absent when it cannot say. It leads the listener by the encoder and client buffers
}

contract PlayoutStatus: { # The station's transport, as one reading
    streamUp: boolean # Whether Liquidsoap's control API is answering at all. False means nothing can air, whatever the running order holds
    nowPlaying?: PlayoutNowPlaying
    upNext: array(PlayoutItem) # Waiting here, in order. Excludes what the player already holds
    queuedCount: number # How many items are waiting in total, of which `upNext` is the head
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
