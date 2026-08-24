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
