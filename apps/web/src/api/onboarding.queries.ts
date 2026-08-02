import { queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { AdminAccountOnboardingRequirementInput, OnboardingRequirement } from '@deadair/sdk';

import { sdk } from './client';
import { queryKeys } from './query.keys';

/**
 * The outstanding onboarding requirements.
 *
 * `staleTime: Infinity` because this list only changes when *we* change it, by submitting a
 * requirement — and the server hands back the remaining list when we do, which is written straight
 * into the cache below. Nothing else can move it, so re-asking on a schedule would be waste.
 */
export const onboardingRequirementsOptions = queryOptions({
    queryKey: queryKeys.onboarding.requirements(),
    queryFn: () => sdk.onboarding.getOnboardingRequirements(),
    staleTime: Infinity,
});

export function useOnboardingRequirements() {
    return useQuery(onboardingRequirementsOptions);
}

/** Forces the next read to hit the API. For a step that completed without reporting a new list. */
export async function invalidateOnboardingRequirements(queryClient: QueryClient): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: queryKeys.onboarding.requirements() });
}

/**
 * Creates the first administrator, satisfying the `admin.account` requirement.
 *
 * The response is authoritative about what is still outstanding, so it is written to the cache
 * directly. That is the round trip the old module-level cache saved by hand, and it is why the
 * wizard can re-run the router's gates immediately without a second GET.
 */
export function useSubmitAdminAccount() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (value: AdminAccountOnboardingRequirementInput['value']) =>
            sdk.onboarding.submitOnboardingRequirement({ key: 'admin.account', value }),
        onSuccess: (remaining: OnboardingRequirement[]) => {
            queryClient.setQueryData(queryKeys.onboarding.requirements(), remaining);
        },
    });
}
