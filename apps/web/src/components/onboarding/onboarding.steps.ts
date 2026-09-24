import type { ComponentType } from 'react';
import type { OnboardingRequirement } from '@deadair/sdk';

import { i18n } from '../../i18n/i18n.setup';
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

/**
 * Requirement key to the UI that satisfies it. Unknown keys are rendered as unsupported.
 *
 * The label is a getter, read when the stepper draws, so it follows the language on screen rather
 * than the one this module was imported in.
 */
export const ONBOARDING_STEPS: Record<string, OnboardingStep> = {
    'admin.account': {
        get label() {
            return i18n.t('onboarding:steps.adminAccount');
        },
        component: AdminAccountStep,
    },
};
