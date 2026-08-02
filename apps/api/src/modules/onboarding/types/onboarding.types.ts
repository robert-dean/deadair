import { z } from 'zod';

type _JsonValue = string | number | boolean | null | _JsonValue[] | { [key: string]: _JsonValue };
const _ZodJson: z.ZodType<_JsonValue> = z.lazy(() =>
    z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(_ZodJson), z.record(z.string(), _ZodJson)]),
);

/**
 * A single onboarding requirement
 * generated from [OnboardingRequirement](file://./../../../../data/contracts/onboarding/onboarding.types.ck#L7)
 */
const OnboardingRequirementBase = z.strictObject({
    key: z.string().min(1).max(100).describe('Stable dot-notation key, e.g. instance.base.url'),
    title: z.string().min(1).max(200).describe('Human-readable label for the onboarding checklist'),
    description: z.string().optional().describe('Optional longer explanation'),
    optional: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe('Whether the requirement is optional for onboarding'),
    value: _ZodJson.describe('The value of the requirement'),
});

export const OnboardingRequirement = z.strictObject({
    key: z.string().min(1).max(100).describe('Stable dot-notation key, e.g. instance.base.url'),
    title: z.string().min(1).max(200).describe('Human-readable label for the onboarding checklist'),
    description: z.string().optional().describe('Optional longer explanation'),
    optional: z
        .preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
        .describe('Whether the requirement is optional for onboarding'),
});
export type OnboardingRequirement = z.infer<typeof OnboardingRequirement>;

export const OnboardingRequirementInput = z.strictObject({
    key: z.string().min(1).max(100).describe('Stable dot-notation key, e.g. instance.base.url'),
    value: _ZodJson.describe('The value of the requirement'),
});
export type OnboardingRequirementInput = z.infer<typeof OnboardingRequirementInput>;
