import { useState } from 'react';
import { Alert, Button, Card, Group, Stack, Text, Title } from '@mantine/core';
import { useSearch } from '@tanstack/react-router';
import type { AuthenticationFactor, OidcProviderSummary } from '@deadair/sdk';

import { useLinkOidcFactor, useRemoveFactor } from '../../api/auth.factors.queries';
import { useSigninProviders } from '../../api/auth.providers.queries';
import { ConfirmModal } from '../shared/confirm.modal';
import { ErrorAlert } from '../shared/error.alert';
import { notifyDone } from '../shared/notify';
import { isStepUpCancelled, type useStepUpGate } from './step.up.dialog';

type Gate = ReturnType<typeof useStepUpGate>;

/** What the API sends back to Security when a link was refused, in words. */
const LINK_ERRORS: Record<string, string> = {
    already_linked: 'That sign-in already belongs to a different account on this station, so it was not linked to yours.',
};

/** A linked factor's provider button text, or its name when the provider has since been removed. */
function providerLabel(name: string | undefined, providers: readonly OidcProviderSummary[]): string {
    return providers.find(provider => provider.name === name)?.label ?? name ?? 'Single sign-on';
}

/**
 * The identity providers this account can sign in through, and the ones it could.
 *
 * Linking leaves the console for the provider and comes back here, which is why the outcome arrives
 * as a query parameter rather than a mutation result. Drawn only on a station that offers a
 * provider or on an account that still holds a link to one the operator has since removed.
 */
export function LinkedSigninsCard({ factors, gate }: { factors: readonly AuthenticationFactor[]; gate: Gate }) {
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
                        Linked sign-ins
                    </Title>
                    <Text size="sm" c="dimmed">
                        Sign in to this account through a provider instead of a password. Linking one sends you there to prove it is yours, and back.
                    </Text>
                </Stack>

                {search.linked ? (
                    <Alert color="teal" title="Linked">
                        {`${providerLabel(search.linked, providers)} now signs you in to this account.`}
                    </Alert>
                ) : undefined}
                {search.link_error ? (
                    <ErrorAlert title="Not linked">{LINK_ERRORS[search.link_error] ?? 'That provider was not linked. Try again.'}</ErrorAlert>
                ) : undefined}
                {link.error ? (
                    <ErrorAlert title="Could not start linking" error={link.error} fallback="Could not reach that provider. Try again." />
                ) : undefined}

                <Stack gap="xs">
                    {linked.map(factor => (
                        <LinkedRow key={factor.methodId} factor={factor} label={providerLabel(factor.label, providers)} gate={gate} />
                    ))}
                    {linked.length === 0 ? (
                        <Text size="sm" c="dimmed">
                            No provider linked yet.
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
                                Link {provider.label}
                            </Button>
                        ))}
                    </Group>
                ) : undefined}
            </Stack>
        </Card>
    );
}

function LinkedRow({ factor, label, gate }: { factor: AuthenticationFactor; label: string; gate: Gate }) {
    const remove = useRemoveFactor();
    const [confirming, setConfirming] = useState(false);
    const [failure, setFailure] = useState<unknown>();

    async function confirmRemove(): Promise<void> {
        setFailure(undefined);
        try {
            await gate.run(() => remove.mutateAsync({ method: 'oidc', methodId: factor.methodId }));
            setConfirming(false);
            notifyDone(`${label} unlinked.`);
        } catch (caught) {
            if (isStepUpCancelled(caught)) return;
            setFailure(caught);
        }
    }

    return (
        <Group justify="space-between" wrap="nowrap">
            <Text size="sm">{label}</Text>
            <Button variant="subtle" color="red" size="compact-sm" onClick={() => setConfirming(true)}>
                Unlink
            </Button>
            <ConfirmModal
                opened={confirming}
                onClose={() => {
                    setConfirming(false);
                    setFailure(undefined);
                }}
                onConfirm={() => void confirmRemove()}
                title={`Unlink ${label}?`}
                confirmLabel="Unlink"
                confirming={remove.isPending}
                error={failure}
                errorTitle="Still linked"
                errorFallback="The provider is still linked."
            >
                {`${label} will stop signing you in to this account. You can link it again afterwards.`}
            </ConfirmModal>
        </Group>
    );
}
