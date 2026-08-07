options {
    keys: {
        area: authentication
    }
    services: {
        AuthenticationService: "#src/modules/authentication/authentication.service.js"
        AuthenticationRegistrationService: "#src/modules/authentication/authentication.registration.service.js"
    }
}

operation /auth/token: {
    post: { # Request authenticated token
        name: Request token
        service: AuthenticationService.requestToken
        security: none
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
        security: none
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
        security: none
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
        security: none
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
        security: none
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
        # Anonymous by necessity, and stated rather than left off: an omitted security block is not
        # public, it generates a bare `requirePolicy()`, which is a session-plus-MFA gate. The only
        # caller here is a browser following a link out of an email, carrying no session at all.
        security: none
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
