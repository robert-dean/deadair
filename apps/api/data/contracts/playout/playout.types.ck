options {
    keys: {
        area: playout
    }
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
