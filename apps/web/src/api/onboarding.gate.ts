import type { OnboardingRequirement } from '@deadair/sdk';

export const ONBOARDING_PATH = '/onboarding';

/**
 * Where an onboarding-aware navigation should land, or undefined to stay put.
 * Outstanding requirements pin the user to the wizard; an empty list evicts them from it.
 */
export function resolveOnboardingRedirect(pathname: string, requirements: OnboardingRequirement[]): '/onboarding' | '/' | undefined {
    if (requirements.length > 0) {
        return pathname === ONBOARDING_PATH ? undefined : ONBOARDING_PATH;
    }
    return pathname === ONBOARDING_PATH ? '/' : undefined;
}
