options {
    keys: {
        area: director
    }
    services: {
        BlockRulesService: "#src/modules/director/block.rules.service.js"
    }
    security: {
        # The floor is the WRITE end, as on the clock: most of this file is writes, so a route added
        # without its own block inherits the tighter gate. The two reads override it downward.
        policy: platform.manage
    }
}

# Never-play rules, and the one lean the station can be given. Every write answers the whole list,
# as the clock does, because a console holding one row is holding a list it has to refetch anyway.

operation /rules: {
    get: { # Every never-play rule on this station, newest first, each saying whether it holds right now
        name: List never-play rules
        service: BlockRulesService.list
        security: {
            policy: platform.view
        }
        response: {
            200: {
                application/json: BlockRuleList
            }
        }
    }
    post: { # Adds a rule. It holds from the next record the station chooses
        name: Add a never-play rule
        service: BlockRulesService.add
        request: {
            application/json: BlockRule
        }
        response: {
            200: {
                application/json: BlockRuleList
            }
        }
    }
}

# Before `/rules/{id}`, and that is load-bearing: `/rules/steer` also matches `/rules/{id}`, whose id
# is a uuid, so the other way round every write to the steer answers 400 from the id check.

operation /rules/steer: {
    get: { # The lean in force, if any
        name: Read the genre steer
        service: BlockRulesService.readSteer
        security: {
            policy: platform.view
        }
        response: {
            200: {
                application/json: GenreSteerReading
            }
        }
    }
    put: { # Leans the station toward some genres for a number of hours, replacing any lean already in force
        name: Steer toward genres
        service: BlockRulesService.steer
        request: {
            application/json: GenreSteerInput
        }
        response: {
            200: {
                application/json: GenreSteerReading
            }
        }
    }
    delete: { # Ends the lean now
        name: Stop steering
        service: BlockRulesService.stopSteering
        response: {
            200: {
                application/json: GenreSteerReading
            }
        }
    }
}

operation /rules/{id}: {
    params: {
        id: uuid
    }

    put: { # Replaces a rule
        name: Change a never-play rule
        service: BlockRulesService.change
        request: {
            application/json: BlockRule
        }
        response: {
            200: {
                application/json: BlockRuleList
            }
            404:
        }
    }

    delete: { # Removes a rule
        name: Remove a never-play rule
        service: BlockRulesService.remove
        response: {
            200: {
                application/json: BlockRuleList
            }
            404:
        }
    }
}
