options {
    keys: {
        area: authentication
        subarea: sessions
    }
    services: {
        SessionsService: "#src/modules/authentication/sessions.service.js"
    }
}

operation /auth/logout: {
    post: { # revoke the caller's current session (self sign-out). Deliberately carries no policy gate: signing out must always clear the browser's httpOnly refresh cookie, including for a caller whose access token has already expired. A 401 here would leave a 30-day refresh cookie behind that silently signs the user back in on the next page load. SessionsService revokes the session only when the caller is actually authenticated; an anonymous caller still gets 204 and a cleared cookie.
        name: Logout
        service: SessionsService.revokeCurrentSession
        security: none
        response: {
            204:
        }
    }
}

# ── Who am I ────────────────────────────────────────────────────────────────────────────
#
# Roles are resolved per request from the tuple store and never live in the token: the JWT
# carries no roles and the token response's `scope` is empty. So a client that wants to know
# whether to DRAW an operator control, rather than draw it and be told 403, has exactly this one
# way to find out. The answer is a hint about what to show; the API stays the gate on every
# operation regardless.

operation /auth/session: {
    get: { # Who the caller is and which platform roles they hold
        name: Read session
        service: SessionsService.readCurrentSession
        security: {
            # The read floor rather than `policy: none`. A signed-in actor holding no role can do
            # nothing else either, so answering 403 here says the same thing every other read
            # would say — and both platform roles grant it, which is the point of asking.
            policy: platform.view
        }
        response: {
            200: {
                application/json: AuthSession
            }
        }
    }
}
