options {
    keys: {
        area: health
    }
    services: {
        HealthService: "#src/modules/health/health.service.js"
    }
}

# ── Liveness ───────────────────────────────────────────────────────────────────────────
#
# Public and unauthenticated, for the same reason `/nowplaying` is: the callers are a
# container healthcheck, a dev-server readiness probe and a process supervisor, none of
# which hold a session and all of which are asking the one question this answers — is
# there a process on this port serving requests.
#
# TWO PATHS, one answer. `/healthcheck` is the spelling the transaction exemption and the
# audit middleware were written against; `/health` is the one every probe in this repo's
# compose file already uses against the other services, and the one that was arriving here
# and getting logged as a 404 warning by the framework's catch-all. Serving both costs one
# route and settles the disagreement, rather than leaving the answer to whichever spelling
# the next prober happens to pick.
#
# `operation(internal)` on both: this is infrastructure, and the console has no business
# calling it, so it generates a router and no SDK method.

operation(internal) /health: {
    get: {
        name: Get health
        service: HealthService.liveness
        security: none
        response: {
            200: {
                application/json: Health
            }
        }
    }
}

operation(internal) /healthcheck: {
    get: {
        name: Get healthcheck
        service: HealthService.liveness
        security: none
        response: {
            200: {
                application/json: Health
            }
        }
    }
}
