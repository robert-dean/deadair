options {
    keys: {
        area: stream
    }
    services: {
        StreamListenersService: "#src/modules/stream/stream.listeners.service.js"
    }
    security: {
        # `platform.manage`, and NOT the `platform.view` a listener-role account holds: what this
        # answers is other people's addresses, which is personal data, and a listener has no
        # business with anybody else's. It is excluded from MCP for the same reason `logs.ck` is,
        # so a model acting on a grant is never handed them either.
        policy: platform.manage
    }
}

# Who is listening, connection by connection, for the operator. The count has always been public
# (`GET /nowplaying`); this is the list behind it, and nothing about it is stored, polled or logged.
# Icecast is asked per mount when the request arrives, and the HLS players are the register the
# heartbeat middleware already keeps. See docs/internals/playout.md, "Knowing who is listening".

operation /stream/listeners: {
    get: { # Who is connected to the station's stream right now, over Icecast and over HLS
        name: List stream listeners
        mcp: exclude
        service: StreamListenersService.listListeners
        response: {
            200: {
                application/json: StreamListeners
            }
        }
    }
}
