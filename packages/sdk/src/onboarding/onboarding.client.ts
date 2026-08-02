import type { SdkFetch } from '../sdk-options.js';
import { bigIntReplacer, parseJson } from '../sdk-options.js';
import type { OnboardingRequirement, OnboardingRequirementInput } from './types/onboarding.types.js';

export class OnboardingClient {
    constructor(private fetch: SdkFetch) {}

    /** @name Get Onboarding Requirements */
    async getOnboardingRequirements(): Promise<OnboardingRequirement[]> {
        const result = await this.fetch(`/onboarding`, { method: 'GET' });
        return await parseJson<OnboardingRequirement[]>(result);
    }

    /** @name Submit Onboarding Requirement */
    async submitOnboardingRequirement(body: OnboardingRequirementInput): Promise<OnboardingRequirement[]> {
        const result = await this.fetch(`/onboarding`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<OnboardingRequirement[]>(result);
    }
}
