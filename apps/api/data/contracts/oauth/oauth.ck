options {
    keys: {
        area: oauth
    }
    services: {
        OAuthConsentService: "#src/modules/oauth/oauth.consent.service.js"
        OAuthClientsService: "#src/modules/oauth/oauth.clients.service.js"
        OAuthGrantsService: "#src/modules/oauth/oauth.grants.service.js"
    }
    security: {
        # The floor: a signed-in account holding either platform role, as for API keys, because an
        # app approved here acts as that account and an account with no role could give it nothing.
        # A request made with an API key passes this gate and is refused by the services, which call
        # `requireAuthentication`: a key must never approve an app. Registering apps by hand is an
        # operator's job and overrides this upward.
        policy: platform.view
    }
}

operation /auth/oauth/authorize/context: {
    post: { # Validate an app's authorization request for the consent page, and stash it for the signed-in person. A POST because it stashes: what is approved is exactly what was validated here
        name: Describe authorization request
        mcp: exclude
        service: OAuthConsentService.describe
        request: {
            application/json: OAuthAuthorizationQuery
        }
        response: {
            200: {
                application/json: OAuthAuthorizationContextResult
            }
        }
    }
}

operation /auth/oauth/authorize/approve: {
    post: { # Let the app act as the signed-in person, as far as the chosen scopes allow. Once the account has a strong second factor, this needs one verified in the last five minutes
        name: Approve authorization request
        mcp: exclude
        service: OAuthConsentService.approve
        request: {
            application/json: OAuthAuthorizationApproval
        }
        response: {
            200: {
                application/json: OAuthAuthorizationOutcome
            }
        }
    }
}

operation /auth/oauth/authorize/deny: {
    post: { # Turn the app away. It is told the person said no
        name: Deny authorization request
        mcp: exclude
        service: OAuthConsentService.deny
        request: {
            application/json: OAuthAuthorizationDecision
        }
        response: {
            200: {
                application/json: OAuthAuthorizationOutcome
            }
        }
    }
}

operation /auth/oauth/clients: {
    get: { # Every app registered with the station, by an operator or by itself
        name: List OAuth clients
        mcp: exclude
        service: OAuthClientsService.list
        security: {
            policy: platform.manage
        }
        response: {
            200: {
                application/json: OAuthClientList
            }
        }
    }
    post: { # Register an app by hand. The secret, for an app that keeps one, is in this response and nowhere else
        name: Create OAuth client
        mcp: exclude
        service: OAuthClientsService.create
        security: {
            policy: platform.manage
        }
        request: {
            application/json: OAuthClientCreate
        }
        response: {
            201: {
                application/json: OAuthClientIssued
            }
        }
    }
}

operation /auth/oauth/clients/{clientId}: {
    params: {
        clientId: string(max=200)
    }
    delete: { # Withdraw an app. Every person's approval of it ends, and so does every token it holds
        name: Revoke OAuth client
        mcp: exclude
        service: OAuthClientsService.revoke
        security: {
            policy: platform.manage
        }
        response: {
            204:
        }
    }
}

operation /auth/oauth/grants: {
    get: { # The apps the signed-in person has let act as them
        name: List OAuth grants
        mcp: exclude
        service: OAuthGrantsService.list
        response: {
            200: {
                application/json: OAuthGrantList
            }
        }
    }
}

operation /auth/oauth/grants/{id}: {
    params: {
        id: uuid
    }
    delete: { # Disconnect an app. Every token it holds for this person stops working at once
        name: Revoke OAuth grant
        mcp: exclude
        service: OAuthGrantsService.revoke
        response: {
            204:
        }
    }
}
