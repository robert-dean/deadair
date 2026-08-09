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

# ── The stream container's half: the bridge ────────────────────────────────────────────
#
# Everything under `/playout/bridge/` is called by a process in the stream container rather
# than by a person, and the PREFIX is the gate. `bridge.secret.middleware` checks the shared
# secret on any path beginning with it, answering 404 while the secret is unseeded and 401
# when it does not match — so a route added here is gated by living here, and there is no
# per-handler call anyone can forget. Do not put an operation under this prefix that is not
# part of the bridge, and do not add a bridge route anywhere else.
#
# `security: none` on each is correct and is not an absence. ContractKit's policies evaluate
# against an actor resolved from a session; Liquidsoap and Icecast have neither and present a
# bare secret in a header, which no policy can read. Omitting the block would be the actual
# mistake: it generates `requirePolicy()`, which gates on a session these callers cannot have.
#
# There is no `headers:` block either, for the same reason there is no per-handler check: the
# middleware has already rejected a missing, empty or wrong secret before any of this runs, so
# declaring the header again would only give the services a parameter they must not act on.
#
# `internal` keeps them out of the SDK. It is a generation flag, not a security property —
# these routes are live on the wire like any other.

# Icecast's listener hooks. Icecast presents the secret as HTTP basic, because its URL
# authenticator can send no header of its own; `listener.credential.middleware` moves it onto
# `x-playout-secret` before ServerKit's authentication middleware deletes the Authorization
# header, and before the bridge gate reads it. The 200 carries the header Icecast reads as
# "admit this listener": an `add` is a blocking authentication call, so a refusal here is a
# listener who is refused the mount.
operation(internal) /playout/bridge/listener: {
    post: { # Notes a listener arriving or leaving, so the station reacts the moment somebody tunes in rather than at the next poll of Icecast's stats. The count itself still comes from the poll, which is what makes a dropped event harmless
        name: Note a listener
        service: PlayoutService.noteListener
        security: none
        query: PlayoutListenerQuery
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

# Liquidsoap's air confirmation. The secret is the same one the app presents when pushing to
# Liquidsoap's own /control/* endpoints, materialized into radio.env by the stream module.
operation(internal) /playout/bridge/aired: {
    post: { # Confirms which rundown item actually started playing. An item is pushed, and downloaded, one item AHEAD of air, so this notify is the only thing that knows what the listener is hearing the moment it changes
        name: Confirm aired item
        service: PlayoutService.confirmAired
        security: none
        query: PlayoutAiredQuery
        response: {
            204:
        }
    }
}

# Liquidsoap reporting that its playout queue stopped producing while deadair still held the
# mount, and that it started again. Pushed rather than polled because the app's reconcile runs
# every two seconds, so a gap shorter than that is invisible to it entirely and one starting
# just after a tick is seen two seconds late — and a gap is the only symptom of a running order
# the station cannot actually play.
#
# NB: this is the one bridge route with a side effect beyond bookkeeping (it brings the
# reconcile forward), which is a second reason the gate on this prefix cannot be optional.
operation(internal) /playout/bridge/starve: {
    post: { # Reports that the running order stopped producing audio, or started again. The mount has fallen through to the local bed in between, so nothing deadair programmed is being heard
        name: Note a starved running order
        service: PlayoutService.noteStarve
        security: none
        query: PlayoutStarveQuery
        response: {
            204:
        }
    }
}
