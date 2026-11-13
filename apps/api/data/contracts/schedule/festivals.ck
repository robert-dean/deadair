options {
    keys: {
        area: schedule
    }
    services: {
        FestivalService: "#src/modules/schedule/festival.service.js"
    }
    security: {
        # The floor is the WRITE end, as on the occasions: most of this file is writes, so a route added
        # without its own block inherits the tighter gate. The reads override it downward.
        policy: platform.manage
    }
}

# Every write answers the whole list, as the occasions do, because a console holding one row is holding a
# list it has to refetch anyway.

operation /festivals: {
    get: { # Every festival on this station, soonest first, each saying whether it is still to come, on now or over
        name: List festivals
        service: FestivalService.list
        security: {
            policy: platform.view
        }
        response: {
            200: {
                application/json: FestivalList
            }
        }
    }
    post: { # Adds a festival. A show names it from the schedule, and nothing is said about it until one does
        name: Add a festival
        service: FestivalService.add
        request: {
            application/json: Festival
        }
        response: {
            200: {
                application/json: FestivalList
            }
        }
    }
}

operation /festivals/{id}: {
    params: {
        id: uuid
    }

    put: { # Replaces a festival and its whole bill. A show naming it plays and talks about the new one from its next refill and its next break
        name: Change a festival
        service: FestivalService.change
        request: {
            application/json: Festival
        }
        response: {
            200: {
                application/json: FestivalList
            }
            404:
        }
    }

    delete: { # Removes a festival. A show that named it carries on as the show it otherwise is
        name: Remove a festival
        service: FestivalService.remove
        response: {
            200: {
                application/json: FestivalList
            }
            404:
        }
    }
}
