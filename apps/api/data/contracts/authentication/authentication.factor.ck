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

operation /auth/factors/{method}/{methodId}: {
    params: {
        method: AuthenticationFactorMethod
        methodId: string(max=255)
    }
    delete: { # Remove one of the caller's own factors. Answered only for `authenticator` today, and only after a recent strong-factor verification: the same gate enrolment sits behind once a strong factor exists, so a stolen session cannot quietly switch the second factor off. Removing the last authenticator turns the sign-in challenge off for that account.
        name: Remove factor
        service: AuthenticationRegistrationService.removeFactor
        response: {
            204:
        }
    }
}
