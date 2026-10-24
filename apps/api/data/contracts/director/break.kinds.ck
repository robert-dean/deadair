options {
    keys: {
        area: director
    }
    services: {
        BreakKindsService: "#src/modules/director/break.kinds.service.js"
    }
    security: {
        # The floor is the WRITE end, as in the clock and the topics: this file is one read and three
        # writes, so a route added without a block of its own is likelier to be another write, and
        # inheriting the tighter gate is the failure that gets reported rather than the one that goes
        # quiet. The read overrides it downward.
        policy: platform.manage
    }
}

# The kinds of break an operator writes rather than the station ships. Ideas #24.
#
# Every mutation answers the whole list, as the clock and the topics do: these rows are read together,
# and a caller handed back only the one it named is holding a list it has to refetch anyway.

operation /breaks/kinds: {
    get: { # Every kind of break you have written, switched on or not, in your own order
        name: List break kinds
        service: BreakKindsService.list
        security: {
            # The one read in the file, so it drops to the read floor the console's other pages use.
            policy: platform.view
        }
        response: {
            200: {
                application/json: BreakKindList
            }
        }
    }
    post: { # Writes a new kind of break. Nothing airs it until it is switched on and a band on the format clock names it
        name: Create break kind
        service: BreakKindsService.create
        request: {
            application/json: BreakKind
        }
        response: {
            201: {
                application/json: BreakKindList
            }
        }
    }
}

operation /breaks/kinds/{id}: {
    params: {
        id: string(min=1, max=100)
    }
    put: { # Rewrites one kind of break. Its key cannot change. A break already written keeps the words it was given
        name: Update break kind
        service: BreakKindsService.update
        request: {
            application/json: BreakKind
        }
        response: {
            200: {
                application/json: BreakKindList
            }
        }
    }
    delete: { # Removes a kind of break. Refused while a band on the format clock still names it
        name: Delete break kind
        service: BreakKindsService.remove
        response: {
            200: {
                application/json: BreakKindList
            }
        }
    }
}
