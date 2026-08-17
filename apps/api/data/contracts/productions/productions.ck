options {
    keys: {
        area: productions
    }
    services: {
        ProductionsService: "#src/modules/productions/productions.service.js"
    }
    security: {
        # The floor is the WRITE end, as `plugins.ck` and `personas.ck` set theirs: this file is one
        # read and two operator actions, so a route added without a block of its own is more likely
        # to be another write. The single read overrides it downward.
        policy: platform.manage
    }
}

# ── What the station is making ────────────────────────────────────────────────────────
#
# Both ways in post a REQUEST and neither starts work itself. That is the director's own rule — every
# writer posts a command and none of them writes the running order — and it is what keeps the
# on-demand path honest: commissioning here queues a production exactly as a clock band does, and one
# scheduler drains against the same rules. An operator asking for one does not jump the schedule and
# does not run a pass inline.
#
# It matters more than it looks because this endpoint is expected to be used mostly for PREVIEWING
# what a production sounds like. A preview that outranked the schedule would be the console making
# the station worse by being looked at, which is the exact failure `gate.priority.ts` exists for.

operation /productions: {
    get: { # Everything the station has made or is making, newest first
        name: List productions
        service: ProductionsService.list
        security: {
            # The one read in the file, so it drops to the floor the console's other pages use.
            policy: platform.view
        }
        response: {
            200: {
                application/json: ProductionList
            }
        }
    }
    post: { # Asks the station to make one. It is queued, not started
        name: Request production
        service: ProductionsService.request
        request: {
            application/json: ProductionRequest
        }
        response: {
            201: {
                application/json: Production
            }
        }
    }
}

# Terminal, and that is the whole point rather than a detail. A queue cannot cancel: everything
# already sent will still be delivered, and a broker will happily resurrect a run minutes after
# somebody stopped it. So this writes a state no pass can claim out of, and every pass checks the row
# before it spends anything.
#
# A production that has already aired or failed is refused rather than rewritten, because cancelling
# something that went out would make the record say it never did.
operation /productions/{id}/cancel: {
    params: {
        id: string(min=1, max=100)
    }
    post: { # Stops a production being made, for good
        name: Cancel production
        service: ProductionsService.cancel
        response: {
            200: {
                application/json: Production
            }
        }
    }
}
