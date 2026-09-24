import { useState } from 'react';
import { Alert, Button, Card, Group, Stack, Text, Title } from '@mantine/core';
import { useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { AuthenticationFactor, OidcProviderSummary } from '@deadair/sdk';

import { useLinkOidcFactor, useRemoveFactor } from '../../api/auth.factors.queries';
import { useSigninProviders } from '../../api/auth.providers.queries';
import { i18n } from '../../i18n/i18n.setup';
import { ConfirmModal } from '../shared/confirm.modal';
import { ErrorAlert } from '../shared/error.alert';
import { notifyDone } from '../shared/notify';
import { isStepUpCancelled, type useStepUpGate } from './step.up.dialog';

type Gate = ReturnType<typeof useStepUpGate>;

/** What the API sends back to Security when a link was refused, in words. */
const LINK_ERRORS: Record<string, 'linkedSignins.linkError.alreadyLinked'> = {
    already_linked: 'linkedSignins.linkError.alreadyLinked',
};

/** A linked factor's provider button text, or its name when the provider has since been removed. */
function providerLabel(name: string | undefined, providers: readonly OidcProviderSummary[]): string {
    return providers.find(provider => provider.name === name)?.label ?? name ?? i18n.t('settings:linkedSignins.singleSignOn');
}

/**
 * The identity providers this account can sign in through, and the ones it could.
 *
 * Linking leaves the console for the provider and comes back here, which is why the outcome arrives
 * as a query parameter rather than a mutation result. Drawn only on a station that offers a
 * provider or on an account that still holds a link to one the operator has since removed.
 */
export function LinkedSigninsCard({ factors, gate }: { factors: readonly AuthenticationFactor[]; gate: Gate }) {
    const { t } = useTranslation('settings');
    const providers = useSigninProviders().data ?? [];
    const search = useSearch({ strict: false }) as { linked?: string; link_error?: string };
    const link = useLinkOidcFactor();

    const linked = factors.filter(factor => factor.method === 'oidc');
    const linkedNames = new Set(linked.map(factor => factor.label));
    const unlinked = providers.filter(provider => !linkedNames.has(provider.name));

    if (providers.length === 0 && linked.length === 0) return undefined;

    async function start(provider: string): Promise<void> {
        try {
            const authorizeUrl = await gate.run(() => link.mutateAsync({ provider }));
            window.location.assign(authorizeUrl);
        } catch (caught) {
            // Closed without a code: nothing started. Anything else is on `link.error` below.
            if (isStepUpCancelled(caught)) return;
        }
    }

    return (
        <Card padding="lg">
            <Stack gap="md">
                <Stack gap="xxs">
                    <Title order={2} size="h4">
                        {t('linkedSignins.title')}
                    </Title>
                    <Text size="sm" c="dimmed">
                        {t('linkedSignins.intro')}
                    </Text>
                </Stack>

                {search.linked ? (
                    <Alert color="teal" title={t('linkedSignins.linked.title')}>
                        {t('linkedSignins.linked.body', { provider: providerLabel(search.linked, providers) })}
                    </Alert>
                ) : undefined}
                {search.link_error ? (
                    <ErrorAlert title={t('linkedSignins.linkError.title')}>
                        {t(LINK_ERRORS[search.link_error] ?? 'linkedSignins.linkError.fallback')}
                    </ErrorAlert>
                ) : undefined}
                {link.error ? (
                    <ErrorAlert title={t('linkedSignins.startFailed.title')} error={link.error} fallback={t('linkedSignins.startFailed.fallback')} />
                ) : undefined}

                <Stack gap="xs">
                    {linked.map(factor => (
                        <LinkedRow key={factor.methodId} factor={factor} label={providerLabel(factor.label, providers)} gate={gate} />
                    ))}
                    {linked.length === 0 ? (
                        <Text size="sm" c="dimmed">
                            {t('linkedSignins.none')}
                        </Text>
                    ) : undefined}
                </Stack>

                {unlinked.length > 0 ? (
                    <Group gap="xs">
                        {unlinked.map(provider => (
                            <Button
                                key={provider.name}
                                variant="default"
                                size="compact-sm"
                                loading={link.isPending && link.variables?.provider === provider.name}
                                onClick={() => void start(provider.name)}
                            >
                                {t('linkedSignins.link', { provider: provider.label })}
                            </Button>
                        ))}
                    </Group>
                ) : undefined}
            </Stack>
        </Card>
    );
}

function LinkedRow({ factor, label, gate }: { factor: AuthenticationFactor; label: string; gate: Gate }) {
    const { t } = useTranslation('settings');
    const remove = useRemoveFactor();
    const [confirming, setConfirming] = useState(false);
    const [failure, setFailure] = useState<unknown>();

    async function confirmRemove(): Promise<void> {
        setFailure(undefined);
        try {
            await gate.run(() => remove.mutateAsync({ method: 'oidc', methodId: factor.methodId }));
            setConfirming(false);
            notifyDone(t('linkedSignins.unlink.done', { name: label }));
        } catch (caught) {
            if (isStepUpCancelled(caught)) return;
            setFailure(caught);
        }
    }

    return (
        <Group justify="space-between" wrap="nowrap">
            <Text size="sm">{label}</Text>
            <Button variant="subtle" color="red" size="compact-sm" onClick={() => setConfirming(true)}>
                {t('linkedSignins.unlink.action')}
            </Button>
            <ConfirmModal
                opened={confirming}
                onClose={() => {
                    setConfirming(false);
                    setFailure(undefined);
                }}
                onConfirm={() => void confirmRemove()}
                title={t('linkedSignins.unlink.title', { name: label })}
                confirmLabel={t('linkedSignins.unlink.action')}
                confirming={remove.isPending}
                error={failure}
                errorTitle={t('linkedSignins.unlink.errorTitle')}
                errorFallback={t('linkedSignins.unlink.errorFallback')}
            >
                {t('linkedSignins.unlink.body', { name: label })}
            </ConfirmModal>
        </Group>
    );
}
