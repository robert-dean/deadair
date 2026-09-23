import { Button, Card, Group, Stack, Text, Title } from '@mantine/core';
import type { SigninProviderCheck } from '@deadair/sdk';

import { useSettings, useSigninCheck } from '../../api/settings.queries';
import { sdkError } from '../../api/sdk.error';
import { ErrorAlert } from '../shared/error.alert';
import { PageSkeleton } from '../shared/page.skeleton';
import { StatusLamp } from '../shared/status.lamp';

/** The setting the check is about. Named here rather than imported, as the form names every key it draws. */
const PROVIDERS_KEY = 'signin.providers';

/**
 * Whether the identity providers just saved will work, said on the settings page rather than
 * discovered on the sign-in page.
 *
 * Asks the station, which asks each issuer the way a sign-in would, once per saved list. So a
 * preset's `auth.example.com` left in place, a mistyped realm, or a row missing its client id is a
 * red line here the moment the form is saved, instead of a "Continue with" button that errors for
 * whoever presses it first, or never appears at all.
 *
 * Draws nothing for a station with no providers, and nothing for somebody without the operator's
 * role, who could not change what it says anyway.
 */
export function SigninCheckCard() {
    const settings = useSettings();
    const stored = settings.data?.values[PROVIDERS_KEY];
    const providers = typeof stored === 'string' && stored.trim() !== '' && stored.trim() !== '[]' ? stored : undefined;
    const check = useSigninCheck(providers);

    if (providers === undefined) return undefined;
    if (sdkError(check.error)?.status === 403) return undefined;

    return (
        <Card padding="lg">
            <Stack gap="md">
                <Group justify="space-between" align="flex-start" wrap="nowrap">
                    <Stack gap="xxs">
                        <Title order={2} size="h4">
                            Do they answer?
                        </Title>
                        <Text size="sm" c="dimmed">
                            The station asks each provider for its sign-in details, the way the sign-in page will, whenever this list is saved.
                        </Text>
                    </Stack>
                    <Button variant="default" size="compact-sm" loading={check.isFetching} onClick={() => void check.refetch()}>
                        Check again
                    </Button>
                </Group>

                {check.isPending ? <PageSkeleton variant="rows" count={2} /> : undefined}
                {check.error ? (
                    <ErrorAlert title="Not checked" error={check.error} fallback="The station could not check its providers." />
                ) : undefined}

                {check.data ? (
                    <Stack gap="sm">
                        {check.data.providers.map(provider => (
                            <ProviderLine key={provider.name} provider={provider} />
                        ))}
                        {check.data.unusable.map(sentence => (
                            <Stack key={sentence} gap={2}>
                                <StatusLamp tone="fault" label="Not offered" />
                                <Text size="sm">{sentence}</Text>
                            </Stack>
                        ))}
                    </Stack>
                ) : undefined}
            </Stack>
        </Card>
    );
}

function ProviderLine({ provider }: { provider: SigninProviderCheck }) {
    return (
        <Stack gap={2}>
            <Group gap="xs" wrap="nowrap">
                <StatusLamp tone={provider.ok ? 'ok' : 'fault'} label={provider.ok ? 'Answers' : 'No answer'} />
                <Text size="sm" fw={600}>
                    {provider.label || provider.name}
                </Text>
            </Group>
            <Text size="xs" c="dimmed" style={{ overflowWrap: 'anywhere' }}>
                {provider.issuer}
            </Text>
            {provider.problem ? <Text size="sm">{provider.problem}</Text> : undefined}
        </Stack>
    );
}
