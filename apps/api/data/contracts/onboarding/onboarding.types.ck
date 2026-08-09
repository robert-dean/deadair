options {
    keys: {
        area: onboarding
    }
}

contract OnboardingRequirementKey: enum(admin.account)

contract CoreOnboardingRequirement: { # A single onboarding requirement
    key: OnboardingRequirementKey # The key of the requirement
    title: readonly string(min=1, max=200) # Human-readable label for the onboarding checklist
    description?: readonly string # Optional longer explanation
    optional: readonly boolean # Whether the requirement is optional for onboarding
}

contract AdminAccountOnboardingRequirement: CoreOnboardingRequirement & {
    key: literal("admin.account")
    value: writeonly {
        email: email
        password: string(min=8, max=256) # The password
    }
}

contract OnboardingRequirement: AdminAccountOnboardingRequirement
