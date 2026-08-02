import type { JsonValue, OnboardingRequirement, AdminAccountOnboardingRequirementInput } from '@deadair/sdk';

import { sdk } from './client';

let pending: Promise<OnboardingRequirement[]> | undefined;

/**
 * The outstanding onboarding requirements, fetched at most once until invalidated.
 * Rejections are not cached, so a transient API outage does not poison the app for good.
 */
export function loadOnboardingRequirements(): Promise<OnboardingRequirement[]> {
    pending ??= sdk.onboarding.getOnboardingRequirements().catch((error: unknown) => {
        pending = undefined;
        throw error;
    });
    return pending;
}

export function invalidateOnboardingRequirements(): void {
    pending = undefined;
}

/** Seeds the cache with a list the server already handed back, avoiding a second round trip. */
export function setOnboardingRequirements(requirements: OnboardingRequirement[]): void {
    pending = Promise.resolve(requirements);
}

/** Submits one requirement and returns whatever is still outstanding afterwards. */
export async function submitAdminAccountRequirement(value: AdminAccountOnboardingRequirementInput['value']): Promise<OnboardingRequirement[]> {
    const remaining = await sdk.onboarding.submitOnboardingRequirement({ key: 'admin.account', value });
    setOnboardingRequirements(remaining);
    return remaining;
}
