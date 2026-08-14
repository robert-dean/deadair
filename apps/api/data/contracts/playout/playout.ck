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

operation /playout/start: {
    post: { # Puts the station back on air with the running order it already has, picking it up where Stop left it. Distinct from putting a playlist on air, which builds a new broadcast and throws away what was there. Refused when there is nothing left to resume
        name: Start playout
        service: PlayoutService.start
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
    post: { # Stands the station down: stops what is on air at once and hands the mount back. The running order is LEFT as it is, so `/playout/start` can pick it up where this stopped it. deadair holds the mount on a lease it renews while it has something to play, so stopping goes quiet rather than falling through to a bed nobody programmed
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

# ── The station's own copy of a record ─────────────────────────────────────────────────

# Where the player fetches a record the station has cached. Anonymous, and NOT under
# `/playout/bridge/`: Liquidsoap fetches this with no headers from us, exactly as it fetches
# `/segments/{id}/audio`, and putting it behind the bridge secret would mean minting a signed
# URL for audio the station is already broadcasting unauthenticated to anyone who opens the
# mount. See the note at the top of `render.ck`, which is the same argument.
#
# It does NOT check `playout.trackCache`. A URL already handed to the player for an item about
# to air has to keep working, and refusing to serve a file that exists would turn a settings
# toggle into a gap on the mount. The switch decides which URL is handed out, which is the
# resolver's job and not this route's.
#
# `internal`, unlike the segment audio route: nothing in the console plays a record back, so
# there is no reason for this to reach the SDK.
operation(internal) /playout/audio/{sourceId}: {
    params: {
        sourceId: uuid
    }
    get: { # The station's own copy of one record, by the provider binding it was cached for
        name: Get cached track audio
        service: PlayoutService.getTrackAudio
        security: none
        response: {
            200: {
                # Every format the track store holds. The service returns `contentType` and the
                # router sets ctx.type from it, because Liquidsoap names the temp file it
                # downloads to after the content type and picks its decoder from that name — so
                # announcing one mime for all of them fails as silence rather than as an error.
                audio/mpeg: binary
                audio/wav: binary
                audio/ogg: binary
                audio/flac: binary
                audio/mp4: binary
                headers: {
                    cache-control?: string
                    etag?: string
                }
            }
            # Documented rather than produced here: the conditional-GET middleware turns a fresh
            # 200 carrying an ETag into one. A bare status says exactly that, so the service is
            # not asked to return it.
            304:
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
