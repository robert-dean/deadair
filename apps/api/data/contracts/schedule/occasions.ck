options {
    keys: {
        area: schedule
    }
    services: {
        OccasionService: "#src/modules/schedule/occasion.service.js"
    }
    security: {
        # The floor is the WRITE end, as on the rules: most of this file is writes, so a route added
        # without its own block inherits the tighter gate. The read overrides it downward.
        policy: platform.manage
    }
}

# Every write answers the whole list, as the rules do, because a console holding one row is holding a
# list it has to refetch anyway.

operation /occasions: {
    get: { # Every occasion on this station, in the order a date is matched against them, each saying when it next falls
        name: List occasions
        service: OccasionService.list
        security: {
            policy: platform.view
        }
        response: {
            200: {
                application/json: OccasionList
            }
        }
    }
    post: { # Adds an occasion at the end of the list. Presenters hear of it from the next break written for its day
        name: Add an occasion
        service: OccasionService.add
        request: {
            application/json: Occasion
        }
        response: {
            200: {
                application/json: OccasionList
            }
        }
    }
}

# Before `/occasions/{id}`, and that is load-bearing, for the reason `/rules/steer` comes before
# `/rules/{id}`: the other way round every write here answers 400 from the id check.

operation /occasions/order: {
    put: { # Puts the list in a new order, which decides who wins when two fall on one date
        name: Reorder occasions
        service: OccasionService.reorder
        request: {
            application/json: OccasionOrder
        }
        response: {
            200: {
                application/json: OccasionList
            }
        }
    }
}

operation /occasions/{id}: {
    params: {
        id: uuid
    }

    put: { # Replaces an occasion, keeping its place in the list
        name: Change an occasion
        service: OccasionService.change
        request: {
            application/json: Occasion
        }
        response: {
            200: {
                application/json: OccasionList
            }
            404:
        }
    }

    delete: { # Removes an occasion
        name: Remove an occasion
        service: OccasionService.remove
        response: {
            200: {
                application/json: OccasionList
            }
            404:
        }
    }
}
