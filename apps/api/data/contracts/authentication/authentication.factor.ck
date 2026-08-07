options {
    keys: {
        area: authentication
        subarea: factors
    }
    services: {
        AuthenticationService: "#src/modules/authentication/authentication.service.js"
        AuthenticationRegistrationService: "#src/modules/authentication/authentication.registration.service.js"
    }
    security: {
        # The floor for every operation in this file, cascading file -> route -> operation: an
        # authenticated session, no policy. Managing your own factors is something you do while
        # signed in, and it deliberately stops at "signed in" — a role or MFA gate here would make
        # enrolling your FIRST factor impossible. `/auth/factors/start` overrides this to anonymous
        # and says why at its own verb: it is the one route here reached mid-login.
        policy: none
    }
}

operation /auth/factors: {
    get: { # List authentication factors
        name: List factors
        service: AuthenticationService.listFactors
        response: {
            200: {
                application/json: array(AuthenticationFactor)
            }
        }
    }
}

operation /auth/factors/register: {
    post: { # Register an authentication factor
        name: Register factor
        service: AuthenticationRegistrationService.registerFactor
        request: {
            application/json: AuthenticationFactorRegistration
        }
        response: {
            201: {
                application/json: AuthenticationFactorRegistrationResponse
            }
        }
    }
}

operation /auth/factors/verify: {
    post: { # Verify an authentication factor registration
        name: Verify factor registration
        service: AuthenticationRegistrationService.verifyFactorRegistration
        request: {
            application/json: AuthenticationFactorRegistrationVerification
        }
        response: {
            201: {
                application/json: AuthenticationToken
            }
        }
    }
}

operation /auth/factors/start: {
    post: { # Issue a factor verification challenge for a pending MFA round. Authenticated via the short-lived `mfa_challenge_id` in the body, not by session — this is the only /auth/factors/* route that does not require an authenticated session.
        name: Start factor challenge
        service: AuthenticationService.startFactorChallenge
        security: none
        request: {
            application/json: FactorChallengeStartRequest
        }
        response: {
            200: {
                application/json: FactorChallengeStartResponse
            }
        }
    }
}

operation /auth/mfa/start: {
    post: { # Mint a fresh MFA challenge for the *current* authenticated session so the SPA can satisfy a `step_up_required` denial. Optionally filters eligible factors against an inbound `StepUpRequirement` hint. Returns `enrollment_required` when no enrolled factor matches the requirement so the SPA can route the user into enrollment instead of getting stuck.
        name: Start MFA challenge
        service: AuthenticationService.startStepUpChallenge
        request: {
            application/json: StepUpStartRequest
        }
        response: {
            200: {
                application/json: StepUpStartResponse
            }
        }
    }
}
