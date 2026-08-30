options {
    keys: {
        area: station
    }
    services: {
        LogsService: "#src/modules/station/logs.service.js"
    }
    security: {
        # `platform.manage`, and NOT the `platform.view` the rest of this area sits on, on the same
        # rule `traces.ck` beside it and the plugin log routes both follow: a log is whatever some
        # process chose to write, verbatim, and nobody can promise what is in one.
        #
        # It is not a precaution here, it is a known case. `stream/radio.liq` records that at
        # `LOG_LEVEL=4` the harbor logs every header of every control call — which is what caught two
        # app processes presenting two DIFFERENT bridge secrets to that port, and is therefore also a
        # setting under which the bridge secret is in `liquidsoap.log` in plain text.
        #
        # There is deliberately no read-side scrub. `RotatingLogStore` redacts what it writes,
        # because it knows the shape of what it is writing; a regex over somebody else's log format
        # would be a guess dressed up as a boundary, and the operator gate is the actual boundary.
        policy: platform.manage
    }
}

# The log files this install has, read back without shell access to the box.
#
# The gap this fills: `/plugins/{id}/logs` has always served a plugin's channel, and NOTHING served
# the station's own `api.log` — so the one log that carries every subsystem could only be read by
# somebody who could get a shell onto the container. The single-container deployment exists partly to
# make that unnecessary, and an operator on Docker Desktop cannot usefully read `docker logs` from a
# script either.
#
# The stream's two logs come with it because they were written to be read together:
# `stream/radio.liq` says Liquidsoap's file log was added so "the app's rotating logs and the shim's"
# could all three be read on one timeline. Until now nothing read any of them.
#
# It owns no table, probes nothing and writes nothing. Plugin channels are NOT listed here: they have
# their own route and their own card on the plugin page, and a second door onto the same store would
# be a second thing to keep in step with it.

operation /logs: {
    get: { # Every log this install has, present or not, with its size and when it was last written
        name: List logs
        service: LogsService.listSources
        response: {
            200: {
                application/json: LogSourceList
            }
        }
    }
}

operation /logs/{id}: {
    params: {
        id: string(min=1, max=40) # One of the ids `GET /logs` reported
    }
    get: { # A tail of one log, newest first
        name: Read log
        service: LogsService.readLog
        query: LogQuery
        response: {
            200: {
                application/json: LogPage
            }
            404: # No source with that id. An id that IS a source but has no file yet answers 200 with nothing in it
        }
    }
}

operation /logs/{id}/download: {
    params: {
        id: string(min=1, max=40)
    }
    get: { # The retained log as a plain-text attachment, oldest first, as the file is written
        name: Download log
        service: LogsService.downloadLog
        response: {
            200: {
                text/plain: string
                headers: {
                    Content-Disposition?: string
                }
            }
            404: # No source with that id
        }
    }
}
