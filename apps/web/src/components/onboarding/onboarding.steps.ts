import type { ComponentType } from 'react';
import type { OnboardingRequirement } from '@deadair/sdk';

import { AdminAccountStep } from './steps/admin.account.step';

export interface OnboardingStepProps {
    requirement: OnboardingRequirement;
    /**
     * Hands control back to the wizard. Pass the requirements the server returned so the
     * wizard can seed its cache; omit them when the step has nothing authoritative to report.
     */
    onComplete: (remaining?: OnboardingRequirement[]) => void;
}

export interface OnboardingStep {
    label: string;
    component: ComponentType<OnboardingStepProps>;
}

/** Requirement key to the UI that satisfies it. Unknown keys are rendered as unsupported. */
export const ONBOARDING_STEPS: Record<string, OnboardingStep> = {
    'admin.account': { label: 'Administrator', component: AdminAccountStep },
};
