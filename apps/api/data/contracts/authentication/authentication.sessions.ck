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
    post: { # revoke the caller's current session (self sign-out)
        name: Logout
        service: SessionsService.revokeCurrentSession
        response: {
            204:
        }
    }
}
