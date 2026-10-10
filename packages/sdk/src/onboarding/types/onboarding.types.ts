/**
 * generated from [OnboardingRequirementKey](../../../../../apps/api/data/contracts/onboarding/onboarding.types.ck)
 */
export type OnboardingRequirementKey = 'admin.account';

/**
 * A single onboarding requirement
 * generated from [CoreOnboardingRequirement](../../../../../apps/api/data/contracts/onboarding/onboarding.types.ck)
 */
export interface CoreOnboardingRequirement {
    /** The key of the requirement */
    key: OnboardingRequirementKey;
    /** Human-readable label for the onboarding checklist */
    title: string;
    /** Optional longer explanation */
    description?: string;
    /** Whether the requirement is optional for onboarding */
    optional: boolean;
}

export interface CoreOnboardingRequirementInput {
    /** The key of the requirement */
    key: OnboardingRequirementKey;
}

/**
 * generated from [AdminAccountOnboardingRequirement](../../../../../apps/api/data/contracts/onboarding/onboarding.types.ck)
 */
export interface AdminAccountOnboardingRequirement extends Omit<CoreOnboardingRequirement, 'key'> {
    key: 'admin.account';
}

export interface AdminAccountOnboardingRequirementInput extends Omit<CoreOnboardingRequirementInput, 'key'> {
    key: 'admin.account';
    value: { email: string; password: string };
}

/**
 * generated from [OnboardingRequirement](../../../../../apps/api/data/contracts/onboarding/onboarding.types.ck)
 */
export type OnboardingRequirement = AdminAccountOnboardingRequirement;
export type OnboardingRequirementInput = AdminAccountOnboardingRequirementInput;
