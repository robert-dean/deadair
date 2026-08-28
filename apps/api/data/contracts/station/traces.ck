options {
    keys: {
        area: station
    }
    services: {
        TracesService: "#src/modules/station/traces.service.js"
    }
    security: {
        # `platform.manage`, and NOT the `platform.view` the rest of this area sits on.
        #
        # The same reason the plugin log routes are gated that way, reached from the other direction:
        # a span's `error` is whatever a plugin threw, verbatim, and a careless plugin can put a
        # token in a message. `activity.ck` argues the opposite for itself and is right to — the feed
        # is the app's own sentences over its own rows — but this file carries third-party text and
        # inherits the caution that earns.
        policy: platform.manage
    }
}

# What the station did, decision by decision, and what each one cost.
#
# It owns no table and probes nothing: the spans are already on disk, written at the moment each call
# ended, and this is the reader that was missing. The window is whatever `trace.spans.ts` has kept,
# which is a bounded number of days rather than a history.

operation /traces: {
    get: { # Recent decisions, newest first, folded to one row each
        name: Read traces
        service: TracesService.readTraces
        query: TracesQuery
        response: {
            200: {
                application/json: TracesPage
            }
        }
    }
}

operation /traces/{id}: {
    params: {
        id: string(min=1, max=200) # The job or request id. A unique prefix is enough
    }
    get: { # One decision: every call it made, and the decisions on either side of it
        name: Read trace
        service: TracesService.readTrace
        response: {
            200: {
                application/json: TraceDetail
            }
            404: # No decision with that id inside the kept window
        }
    }
}
