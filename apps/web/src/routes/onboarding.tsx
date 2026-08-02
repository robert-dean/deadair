import { createFileRoute } from '@tanstack/react-router';

import { onboardingRequirementsOptions } from '../api/onboarding.queries';
import { OnboardingWizard } from '../components/onboarding/onboarding.wizard';

function OnboardingRoute() {
    const requirements = Route.useLoaderData();
    return <OnboardingWizard requirements={requirements} />;
}

export const Route = createFileRoute('/onboarding')({
    // Shares the cache with the root gate, so landing here costs no extra request.
    loader: ({ context }) => context.queryClient.ensureQueryData(onboardingRequirementsOptions),
    component: OnboardingRoute,
});
