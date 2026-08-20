options {
    keys: {
        area: director
    }
    services: {
        ClockService: "#src/modules/director/clock.service.js"
    }
    security: {
        # The floor is the WRITE end, as in the schedule and personas contracts: this file is one
        # read and three writes, so a route added without a block of its own is far likelier to be
        # another write, and inheriting the tighter gate is the failure that gets reported rather
        # than the one that goes quiet. The single read overrides it downward.
        policy: platform.manage
    }
}

# The station's format clock: what it SAYS, and when. The other half of the schedule beside it —
# a slot says what a stretch of the day plays and who hosts it, a band says what the station says
# while it does.
#
# Every mutation answers the whole clock rather than the row it touched, exactly as the schedule
# and the personas do. Order is preference here, so an edit that moves one band changes how the
# ones around it are read and a caller handed back only its own row is holding a list it has to
# refetch anyway.

operation /clock/bands: {
    get: { # Every band on this station's clock, including the ones switched off, in the operator's own order
        name: List clock bands
        service: ClockService.list
        security: {
            # The one read in the file, so it drops to the read floor the console's other pages use.
            policy: platform.view
        }
        response: {
            200: {
                application/json: ClockBandList
            }
        }
    }
    post: { # Adds a band. It claims its first boundary on the next commit pass
        name: Create clock band
        service: ClockService.create
        request: {
            application/json: ClockBand
        }
        response: {
            201: {
                application/json: ClockBandList
            }
        }
    }
}

operation /clock/bands/{id}: {
    params: {
        id: string(min=1, max=100)
    }
    put: { # Rewrites one band. Breaks it has already planted stay where they are: the running order is the memory
        name: Update clock band
        service: ClockService.update
        request: {
            application/json: ClockBand
        }
        response: {
            200: {
                application/json: ClockBandList
            }
        }
    }
    delete: { # Removes a band, which costs it the boundaries it had not claimed yet and nothing else
        name: Delete clock band
        service: ClockService.remove
        response: {
            200: {
                application/json: ClockBandList
            }
        }
    }
}
