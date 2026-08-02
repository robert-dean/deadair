import type { JsonValue } from '../../sdk-options.js';

/**
 * A single onboarding requirement
 * generated from [OnboardingRequirement](file://./../../../../../apps/api/data/contracts/onboarding/onboarding.types.ck#L7)
 */
export interface OnboardingRequirement {
    /** Stable dot-notation key, e.g. instance.base.url */
    key: string;
    /** Human-readable label for the onboarding checklist */
    title: string;
    /** Optional longer explanation */
    description?: string;
    /** Whether the requirement is optional for onboarding */
    optional: boolean;
}

export interface OnboardingRequirementInput {
    /** Stable dot-notation key, e.g. instance.base.url */
    key: string;
    /** The value of the requirement */
    value: JsonValue;
}
