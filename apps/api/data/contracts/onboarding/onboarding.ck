options {
    keys: {
        # The `security: none` below is the floor for both verbs, cascading file -> route ->
        # operation. Onboarding runs before the first actor exists, so there is nobody to
        # authenticate. The service is what refuses once the requirements are already satisfied.
        area: onboarding
    }
    services: {
        OnboardingService: "#src/modules/onboarding/onboarding.service.js"
    }
    security: none
}

operation /onboarding: {
    get: {
        name: Get Onboarding Requirements
        service: OnboardingService.getOnboardingRequirements
        response: {
            200: {
                application/json: array(OnboardingRequirement)
            }
        }
    }
    post: {
        name: Submit Onboarding Requirement
        service: OnboardingService.submitOnboardingRequirement
        request: {
            application/json: OnboardingRequirement
        }
        response: {
            200: {
                application/json: array(OnboardingRequirement)
            }
        }
    }
}
