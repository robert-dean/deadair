options {
    keys: {
        # The `security: none` below is the floor for every operation in this file, cascading
        # file -> route -> operation. These are the bootstrap routes: each is reached by a caller
        # who has no session yet, by definition, so all of them are anonymous and none override it.
        #
        # It is stated rather than left off. An omitted security block is NOT public — it generates
        # a bare `requirePolicy()`, which gates on a session plus the MFA policy. That default is
        # exactly what silently broke the magic-link redirect below.
        area: authentication
    }
    services: {
        AuthenticationService: "#src/modules/authentication/authentication.service.js"
        AuthenticationRegistrationService: "#src/modules/authentication/authentication.registration.service.js"
    }
    security: none
}

operation /auth/token: {
    post: { # Request authenticated token
        name: Request token
        service: AuthenticationService.requestToken
        request: {
            application/x-www-form-urlencoded: AuthenticationRequest
            application/json: AuthenticationRequest
        }
        response: {
            201: {
                application/json: AuthenticationTokenResponse
            }
        }
    }
}

operation /auth/login/register: {
    post: { # Register a new login
        name: Register login
        service: AuthenticationRegistrationService.registerLogin
        request: {
            application/json: AuthenticationRegistration
        }
        response: {
            201: {
                application/json: AuthenticationRegistration
            }
        }
    }
}

operation /auth/login/verify: {
    post: { # Verify a login registration
        name: Verify login registration
        service: AuthenticationRegistrationService.verifyLoginRegistration
        request: {
            application/json: AuthenticationRegistrationVerification
        }
        response: {
            201: {
                application/json: AuthenticationToken
            }
        }
    }
}

operation /auth/login/start: {
    post: { # Start a password-less login process
        name: Start login
        service: AuthenticationService.startLogin
        request: {
            application/json: AuthenticationLoginStart
        }
        response: {
            200: {
                application/json: AuthenticationLoginStartResponse
            }
        }
    }
}

operation(internal) /auth/login/oidc/callback: {
    get: { # OIDC callback endpoint. The IdP redirects the user-agent here with `code` and `state`. Server completes the authorization, issues a session, and returns an HTML page that hands the token back to the SPA.
        name: OIDC Callback
        service: AuthenticationService.handleOidcCallback
        query: OidcLoginCallback
        response: {
            200: {
                text/html: string
            }
        }
    }
}

operation(internal) /auth/login/link/redirect: {
    get: { # This is an internal endpoint handling the redirect routing for magic links. When the user follows the link the browser will direct the user to this endpoint which renders as a blank page, and then the user will be redirected to the provided magic link url.
        name: MagicLink Redirect
        service: AuthenticationService.magicLinkRedirect
        query: {
            token: string(max=100) # The magic link token
            token_type: string(max=100) # The token type
        }
        response: {
            200: {
                text/html: string
            }
        }
    }
}
