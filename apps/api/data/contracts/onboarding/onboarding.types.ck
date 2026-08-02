options {
    keys: {
        area: onboarding
    }
}

contract OnboardingRequirement: { # A single onboarding requirement
    key: string(min=1, max=100) # Stable dot-notation key, e.g. instance.base.url
    title: readonly string(min=1, max=200) # Human-readable label for the onboarding checklist
    description?: readonly string # Optional longer explanation
    optional: readonly boolean # Whether the requirement is optional for onboarding
    value: writeonly json # The value of the requirement
}