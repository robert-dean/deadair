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
    post: { # Stands the station down: drops the running order, stops what is on air, and hands the mount back. deadair holds the mount on a lease it renews while it has something to play, so stopping goes quiet rather than falling through to a bed nobody programmed
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
# Declared `internal` so it generates into the router but never into the SDK: the SPA has
# no business calling it, and the only client is a process in the stream container.
# `security: none` because that caller is not an actor and holds no session — it presents a
# shared secret instead, which the service checks in constant time.

# Liquidsoap's air confirmation, gated on the bridge secret — the same one the app presents
# when pushing to its /control/* endpoints, materialized into radio.env by the stream module.
# Icecast's listener hooks, gated on the same bridge secret as every other route here. Icecast
# presents it as HTTP basic, because its URL authenticator can send no header of its own;
# `listener.credential.middleware` moves it onto `x-playout-secret` before ServerKit's
# authentication middleware deletes the Authorization header. The 200 carries the header Icecast
# reads as "admit this listener": an `add` is a blocking authentication call, so a refusal here is
# a listener who is refused the mount.
operation(internal) /playout/listener: {
    post: { # Notes a listener arriving or leaving, so the station reacts the moment somebody tunes in rather than at the next poll of Icecast's stats. The count itself still comes from the poll, which is what makes a dropped event harmless
        name: Note a listener
        service: PlayoutService.noteListener
        security: none
        query: PlayoutListenerQuery
        headers: PlayoutBridgeHeaders
        response: {
            200: {
                text/plain: string
                headers: {
                    icecast-auth-user: string
                }
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
