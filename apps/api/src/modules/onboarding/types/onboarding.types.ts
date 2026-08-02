import { z } from 'zod';

/**
 * generated from [OnboardingRequirementKey](file://./../../../../data/contracts/onboarding/onboarding.types.ck#L7)
 */
export const OnboardingRequirementKey = z.enum(['admin.account']);
export type OnboardingRequirementKey = z.infer<typeof OnboardingRequirementKey>;

/**
 * A single onboarding requirement
 * generated from [CoreOnboardingRequirement](file://./../../../../data/contracts/onboarding/onboarding.types.ck#L9)
 */
export const CoreOnboardingRequirement = z.strictObject({
    key: OnboardingRequirementKey.describe('The key of the requirement'),
    title: z.string().min(1).max(200).describe('Human-readable label for the onboarding checklist'),
    description: z.string().optional().describe('Optional longer explanation'),
    optional: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe('Whether the requirement is optional for onboarding'),
});
export type CoreOnboardingRequirement = z.infer<typeof CoreOnboardingRequirement>;

export const CoreOnboardingRequirementInput = z.strictObject({
    key: OnboardingRequirementKey.describe('The key of the requirement'),
});
export type CoreOnboardingRequirementInput = z.infer<typeof CoreOnboardingRequirementInput>;

/**
 * generated from [AdminAccountOnboardingRequirement](file://./../../../../data/contracts/onboarding/onboarding.types.ck#L16)
 */
const AdminAccountOnboardingRequirementBase = CoreOnboardingRequirement.extend({
    key: z.literal('admin.account'),
    value: z.strictObject({
        email: z.email(),
        password: z.string().min(8).max(256).describe('The password'),
    }),
});

export const AdminAccountOnboardingRequirement = CoreOnboardingRequirement.extend({
    key: z.literal('admin.account'),
});
export type AdminAccountOnboardingRequirement = z.infer<typeof AdminAccountOnboardingRequirement>;

export const AdminAccountOnboardingRequirementInput = CoreOnboardingRequirementInput.extend({
    key: z.literal('admin.account'),
    value: z.strictObject({
        email: z.email(),
        password: z.string().min(8).max(256).describe('The password'),
    }),
});
export type AdminAccountOnboardingRequirementInput = z.infer<typeof AdminAccountOnboardingRequirementInput>;

/**
 * generated from [OnboardingRequirement](file://./../../../../data/contracts/onboarding/onboarding.types.ck#L24)
 */
export const OnboardingRequirement = AdminAccountOnboardingRequirement;
export type OnboardingRequirement = z.infer<typeof OnboardingRequirement>;
export const OnboardingRequirementInput = AdminAccountOnboardingRequirementInput;
export type OnboardingRequirementInput = z.infer<typeof OnboardingRequirementInput>;
