options {
    keys: {
        area: onboarding
    }
    services: {
        OnboardingService: "#src/modules/onboarding/onboarding.service.js"
    }
}

operation /onboarding: {
    get: {
        name: Get Onboarding Requirements
        service: OnboardingService.getOnboardingRequirements
        security: none
        response: {
            200: {
                application/json: array(OnboardingRequirement)
            }
        }
    }
    post: {
        name: Submit Onboarding Requirement
        service: OnboardingService.submitOnboardingRequirement
        security: none
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
