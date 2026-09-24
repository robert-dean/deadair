import { useState } from 'react';
import { Button, Card, Group, Stack, Text, Title } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import type { OAuthGrant } from '@deadair/sdk';

import { useOAuthGrants, useRevokeOAuthGrant } from '../../api/oauth.queries';
import { ConfirmModal } from '../shared/confirm.modal';
import { ErrorAlert } from '../shared/error.alert';
import { formatDate } from '../shared/format.date';
import { notifyDone } from '../shared/notify';
import { PageSkeleton } from '../shared/page.skeleton';

/**
 * The apps this person has let act as them, and a way to disconnect one.
 *
 * Beside the API keys because it is the same question asked the other way round: a key is a
 * credential this person made for something, and a connected app is something that asked and was
 * told yes. Disconnecting needs no second factor, since taking access away is never what a stolen
 * session wants, and the app's tokens stop working at once. Drawn only when there is something to
 * show, so a station that never turned OAuth on looks as it did.
 */
export function ConnectedAppsCard() {
    const { t } = useTranslation('settings');
    const grants = useOAuthGrants();

    if (grants.data?.grants.length === 0 || grants.isPending) return grants.isPending ? <PageSkeleton variant="rows" count={1} /> : undefined;

    return (
        <Card padding="lg">
            <Stack gap="md">
                <Stack gap="xxs">
                    <Title order={2} size="h4">
                        {t('connectedApps.title')}
                    </Title>
                    <Text size="sm" c="dimmed">
                        {t('connectedApps.intro')}
                    </Text>
                </Stack>
                {grants.error ? (
                    <ErrorAlert
                        title={t('connectedApps.unavailable.title')}
                        error={grants.error}
                        fallback={t('connectedApps.unavailable.fallback')}
                    />
                ) : undefined}
                {grants.data ? (
                    <Stack gap="xs">
                        {grants.data.grants.map(grant => (
                            <GrantRow key={grant.id} grant={grant} />
                        ))}
                    </Stack>
                ) : undefined}
            </Stack>
        </Card>
    );
}

function GrantRow({ grant }: { grant: OAuthGrant }) {
    const { t } = useTranslation('settings');
    const revoke = useRevokeOAuthGrant();
    const [confirming, setConfirming] = useState(false);
    const name = grant.clientName ?? grant.clientId;

    return (
        <Group justify="space-between" wrap="nowrap" align="flex-start">
            <Stack gap={2}>
                <Text size="sm">{name}</Text>
                <Text size="xs" c="dimmed">
                    {grant.lastUsedAt
                        ? t('connectedApps.grant.connectedUsed', { date: formatDate(grant.createdAt), used: formatDate(grant.lastUsedAt) })
                        : t('connectedApps.grant.connected', { date: formatDate(grant.createdAt) })}
                </Text>
            </Stack>
            <Button variant="subtle" color="red" size="compact-sm" onClick={() => setConfirming(true)}>
                {t('connectedApps.disconnect.action')}
            </Button>
            <ConfirmModal
                opened={confirming}
                onClose={() => setConfirming(false)}
                onConfirm={() =>
                    void revoke.mutateAsync(grant.id).then(() => {
                        setConfirming(false);
                        notifyDone(t('connectedApps.disconnect.done', { name }));
                    })
                }
                title={t('connectedApps.disconnect.title', { name })}
                confirmLabel={t('connectedApps.disconnect.action')}
                confirming={revoke.isPending}
                error={revoke.error}
                errorTitle={t('connectedApps.disconnect.errorTitle')}
                errorFallback={t('connectedApps.disconnect.errorFallback')}
            >
                {t('connectedApps.disconnect.body', { name })}
            </ConfirmModal>
        </Group>
    );
}
