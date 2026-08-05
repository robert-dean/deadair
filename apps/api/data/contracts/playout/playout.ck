options {
    keys: {
        area: playout
    }
    services: {
        PlayoutService: "#src/modules/playout/playout.service.js"
    }
}

# Liquidsoap's half of the playout bridge. Declared `internal` so it generates into the
# router but never into the SDK: the SPA has no business calling it, and the only client
# is the stream container.
#
# `security: none` because the caller is not an actor and holds no session — it presents
# the shared bridge secret instead, which the service checks in constant time. The same
# secret the app presents when pushing to Liquidsoap's /control/* endpoints, materialized
# into radio.env by the stream module.
# The track shim's bootstrap. It opens its Spotify session lazily, on its first fetch, by
# asking here for the account already linked in the console — so there is no second set of
# credentials anywhere, and the token flows machine-to-machine without touching a browser.
#
# Gated on its own secret rather than the playout one: this hands out an access token, while
# the bridge secret only moves item ids around, and a shim that leaked one should not also
# be able to drain the other.
operation(internal) /playout/spotify/session-login: {
    get: { # Mints a login for the station-side track shim from the connected Spotify plugin
        name: Spotify session login
        service: PlayoutService.spotifySessionLogin
        security: none
        headers: SpotifyLoginHeaders
        response: {
            200: {
                application/json: SpotifySessionLogin
            }
        }
    }
}

operation(internal) /playout/aired: {
    post: { # Confirms which rundown item actually started playing. An item is pushed, and downloaded, one item AHEAD of air, so this notify is the only thing that knows what the listener is hearing the moment it changes
        name: Confirm aired item
        service: PlayoutService.confirmAired
        security: none
        query: PlayoutAiredQuery
        headers: PlayoutBridgeHeaders
        response: {
            204:
        }
    }
}
