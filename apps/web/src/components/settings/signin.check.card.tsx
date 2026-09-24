import { Button, Card, Group, Stack, Text, Title } from '@mantine/core';
import { useTranslation } from 'react-i18next';
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
    const { t } = useTranslation('settings');
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
                            {t('signinCheck.title')}
                        </Title>
                        <Text size="sm" c="dimmed">
                            {t('signinCheck.intro')}
                        </Text>
                    </Stack>
                    <Button variant="default" size="compact-sm" loading={check.isFetching} onClick={() => void check.refetch()}>
                        {t('signinCheck.again')}
                    </Button>
                </Group>

                {check.isPending ? <PageSkeleton variant="rows" count={2} /> : undefined}
                {check.error ? (
                    <ErrorAlert title={t('signinCheck.failed.title')} error={check.error} fallback={t('signinCheck.failed.fallback')} />
                ) : undefined}

                {check.data ? (
                    <Stack gap="sm">
                        {check.data.providers.map(provider => (
                            <ProviderLine key={provider.name} provider={provider} />
                        ))}
                        {check.data.unusable.map(sentence => (
                            <Stack key={sentence} gap={2}>
                                <StatusLamp tone="fault" label={t('signinCheck.notOffered')} />
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
    const { t } = useTranslation('settings');
    return (
        <Stack gap={2}>
            <Group gap="xs" wrap="nowrap">
                <StatusLamp tone={provider.ok ? 'ok' : 'fault'} label={provider.ok ? t('signinCheck.answers') : t('signinCheck.noAnswer')} />
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
