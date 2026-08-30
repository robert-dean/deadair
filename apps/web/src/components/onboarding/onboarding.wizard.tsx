import { useState } from 'react';
import { Alert, Box, Button, Container, Group, LoadingOverlay, Stack, Stepper, Text, Title } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import type { OnboardingRequirement } from '@deadair/sdk';

import { invalidateOnboardingRequirements } from '../../api/onboarding.queries';
import { ONBOARDING_STEPS } from './onboarding.steps';
import { usePhone } from '../shared/use.phone';

export interface OnboardingWizardProps {
    /** The outstanding requirements, newest snapshot from the route loader. */
    requirements: OnboardingRequirement[];
}

/**
 * Walks the operator through whatever the API still needs. There is no local "done" bookkeeping:
 * a completed step returns the server's remaining list, the router re-runs its gates, and the
 * shrinking list decides whether another step appears or the app takes over.
 */
export function OnboardingWizard({ requirements }: OnboardingWizardProps) {
    const phone = usePhone();
    const router = useRouter();
    const queryClient = useQueryClient();
    const [skipped, setSkipped] = useState<string[]>([]);
    const [rechecking, setRechecking] = useState(false);

    const activeIndex = requirements.findIndex(requirement => !skipped.includes(requirement.key));
    const active = activeIndex === -1 ? undefined : requirements[activeIndex];

    async function handleComplete(remaining?: OnboardingRequirement[]): Promise<void> {
        setRechecking(true);
        // A step that reported a list has already written it to the cache through its mutation.
        // One that did not (an `admin.account` that turned out to exist already) leaves the cached
        // list stale, so it has to be re-asked before the gates run again.
        if (!remaining) {
            await invalidateOnboardingRequirements(queryClient);
        }
        try {
            await router.invalidate();
        } finally {
            setRechecking(false);
        }
    }

    function handleSkip(): void {
        if (active) {
            setSkipped(current => [...current, active.key]);
        }
    }

    function renderBody(requirement: OnboardingRequirement) {
        const step = ONBOARDING_STEPS[requirement.key];
        if (!step) {
            return (
                <Alert color="gray" title="Not supported in this build" mt="xl">
                    <Stack gap="xs">
                        <Text size="sm">
                            This build has no screen for{' '}
                            <Text span ff="monospace">
                                {requirement.key}
                            </Text>
                            . Configure it directly, or skip it if it is optional.
                        </Text>
                        {requirement.description ? (
                            <Text size="sm" c="dimmed">
                                {requirement.description}
                            </Text>
                        ) : undefined}
                    </Stack>
                </Alert>
            );
        }
        const StepComponent = step.component;
        return (
            <StepComponent
                requirement={requirement}
                onComplete={remaining => {
                    void handleComplete(remaining);
                }}
            />
        );
    }

    return (
        <Container size="sm" py="xl">
            <Box pos="relative">
                <LoadingOverlay visible={rechecking} zIndex={200} />
                <Stack gap="lg">
                    <Stack gap="xs">
                        <Title order={2}>Set up deadair</Title>
                        <Text c="dimmed">A few things need answering before the station can go on air.</Text>
                    </Stack>
                    {requirements.length === 0 ? (
                        <Text c="dimmed">Nothing left to configure.</Text>
                    ) : (
                        <Stepper
                            active={activeIndex === -1 ? requirements.length : activeIndex}
                            allowNextStepsSelect={false}
                            orientation={phone ? 'vertical' : 'horizontal'}
                        >
                            {requirements.map(requirement => (
                                <Stepper.Step
                                    key={requirement.key}
                                    label={ONBOARDING_STEPS[requirement.key]?.label ?? requirement.title}
                                    description={requirement.optional ? 'Optional' : undefined}
                                >
                                    {renderBody(requirement)}
                                </Stepper.Step>
                            ))}
                            <Stepper.Completed>
                                <Text c="dimmed" mt="xl">
                                    Nothing else to do here.
                                </Text>
                            </Stepper.Completed>
                        </Stepper>
                    )}
                    {active?.optional ? (
                        <Group justify="flex-end">
                            <Button variant="subtle" onClick={handleSkip}>
                                Skip
                            </Button>
                        </Group>
                    ) : undefined}
                </Stack>
            </Box>
        </Container>
    );
}
