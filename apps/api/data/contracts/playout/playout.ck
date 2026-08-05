options {
    keys: {
        area: playout
    }
    services: {
        PlayoutService: "#src/modules/playout/playout.service.js"
    }
}

# ── The console's transport ────────────────────────────────────────────────────────────
#
# Reading the transport is `platform.view`, driving it is `platform.manage`: seeing what
# is on air is what a listener's console shows, while loading a running order or cutting a
# track is an operator action that every listener hears.

operation /playout/status: {
    get: { # What the station is playing and what is queued behind it. The console polls this
        name: Get playout status
        service: PlayoutService.getStatus
        security: {
            policy: platform.view
        }
        response: {
            200: {
                application/json: PlayoutStatus
            }
        }
    }
}

operation /playout/playlist: {
    post: { # Loads a plugin playlist into the running order and starts handing it to the player. Replaces whatever was queued; what is on air finishes rather than being cut off
        name: Play a playlist
        service: PlayoutService.playPlaylist
        security: {
            policy: platform.manage
        }
        request: {
            application/json: PlayoutPlaylistInput
        }
        response: {
            200: {
                application/json: PlayoutStatus
            }
        }
    }
}

operation /playout/skip: {
    post: { # Ends the item on air so the next one starts immediately. The station owns the decoder, so this lands at once rather than waiting out audio already committed to a player
        name: Skip the current item
        service: PlayoutService.skip
        security: {
            policy: platform.manage
        }
        response: {
            200: {
                application/json: PlayoutStatus
            }
        }
    }
}

operation /playout/stop: {
    post: { # Drops the running order and takes back everything queued but not airing. What is on air finishes, then the mount falls back to the local music bed — it never goes silent
        name: Stop playout
        service: PlayoutService.stop
        security: {
            policy: platform.manage
        }
        response: {
            200: {
                application/json: PlayoutStatus
            }
        }
    }
}

# ── The stream container's half ────────────────────────────────────────────────────────
#
# Both are declared `internal` so they generate into the router but never into the SDK:
# the SPA has no business calling either, and the only clients are processes in the stream
# container. `security: none` because neither caller is an actor or holds a session — each
# presents a shared secret instead, which the service checks in constant time.

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

# Liquidsoap's air confirmation, gated on the bridge secret — the same one the app presents
# when pushing to its /control/* endpoints, materialized into radio.env by the stream module.
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
