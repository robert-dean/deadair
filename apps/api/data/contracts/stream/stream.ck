options {
    keys: {
        area: stream
    }
    services: {
        StreamService: "#src/modules/stream/stream.service.js"
    }
    security: {
        # Every operation here decides, or reports, whose Spotify account the station fetches its
        # records as. That is the same question `POST /plugins/{id}/oauth` sits behind, so it takes
        # the same gate, reads included: the read carries the last login failure verbatim, which is
        # an upstream's words rather than the station's own.
        policy: platform.manage
    }
}

# The station's track fetcher, and the one-time authorization it needs before it can fetch anything.
#
# The fetcher logs in to Spotify itself, with a credential of its own, because a token minted for the
# operator's own Spotify app is minted for a different client and is refused however valid it is. So
# an install that has connected the plugin has still not finished: the plugin's account link answers
# the Web API, and the fetcher's stored authorization is what turns a record into audio.
#
# Finishing it is where these routes come in. Spotify returns the operator's browser to a loopback
# address, and that address cannot be moved — the client id is the streaming client's, which this
# project does not own — so on any deployment that does not publish the fetcher's port to the machine
# the operator is sitting at, the browser lands on a page that cannot load. The operator hands the
# address over instead, and the app relays it.

# ── The HLS playlists ──────────────────────────────────────────────────────────────────
#
# Anonymous, like `/segments/{id}/audio` and for a listener rather than for Liquidsoap. A
# player cannot present a bearer token, and this is the station's public output: anyone who
# can reach the mount can reach this.
#
# **Only the playlists.** The SEGMENTS are served by nginx straight off the volume, and the
# split is the whole design rather than an optimisation. A live HLS player has to re-fetch
# the media playlist every target duration to learn what to play next, so a playlist GET is
# a per-client heartbeat that arrives on its own without anything being asked to send one —
# and it is a few hundred bytes, so the audio never goes through Node.
#
# That heartbeat is what makes an HLS listener countable, which is not optional: with
# `playout.airMode: audience` a listener nobody counts is a station that goes quiet with
# somebody listening to it. The two alternatives were both rejected. `auth_request` in nginx
# would put the API in the path of every listener's own connection, which is exactly what
# `<authentication type="url">` did before it was removed from icecast.xml. Counting entries
# in an access log is the "zero and unknown are the same number" failure `AudienceWatch`
# exists to refuse.
#
# The cost is that an HLS listener needs the API up. That is not a real cost: the dead-man
# switch in radio.liq takes the station off air within CONTROL_TTL_S of the app going away,
# so there is nothing to listen to either way.
operation /hls/{name}: {
    params: {
        name: string(min=1, max=120) # A playlist FILENAME, never a path. Refused unless it matches `[A-Za-z0-9_.-]+\.m3u8`, so nothing can walk out of the directory
    }
    get: { # One HLS playlist, and the tick that says somebody is still listening to it
        name: Get HLS playlist
        service: StreamService.getHlsPlaylist
        security: none
        response: {
            200: {
                application/vnd.apple.mpegurl: binary
                headers: {
                    cache-control?: string
                }
            }
            # A station with HLS switched off, or a name that is not a playlist. Both are
            # "there is nothing here", which is what a player retries against harmlessly.
            404:
        }
    }
}

operation /stream/authorization: {
    get: { # What the track fetcher holds by way of a Spotify login, and whether an authorization is already waiting to be finished
        name: Read fetcher authorization
        service: StreamService.readAuthorization
        response: {
            200: {
                application/json: FetcherAuthorization
            }
        }
    }
    post: { # Starts the fetcher's one-time authorization and answers with the URL to open. Starting another replaces whichever was pending
        name: Start fetcher authorization
        service: StreamService.startAuthorization
        response: {
            201: {
                application/json: FetcherAuthorizationStart
            }
        }
    }
}

operation /stream/authorization/complete: {
    post: { # Finishes an authorization from the address the operator's browser ended up at
        name: Finish fetcher authorization
        service: StreamService.finishAuthorization
        request: {
            application/json: FetcherAuthorizationInput
        }
        response: {
            200: {
                application/json: FetcherAuthorizationFinished
            }
        }
    }
}
