import { createFileRoute } from '@tanstack/react-router';

import { loadOnboardingRequirements } from '../api/onboarding';
import { OnboardingWizard } from '../components/onboarding/onboarding.wizard';

function OnboardingRoute() {
    const requirements = Route.useLoaderData();
    return <OnboardingWizard requirements={requirements} />;
}

export const Route = createFileRoute('/onboarding')({
    // Shares the cached promise with the root gate, so landing here costs no extra request.
    loader: () => loadOnboardingRequirements(),
    component: OnboardingRoute,
});
