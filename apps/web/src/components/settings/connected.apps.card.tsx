import { useState } from 'react';
import { Button, Card, Group, Stack, Text, Title } from '@mantine/core';
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
    const grants = useOAuthGrants();

    if (grants.data?.grants.length === 0 || grants.isPending) return grants.isPending ? <PageSkeleton variant="rows" count={1} /> : undefined;

    return (
        <Card padding="lg">
            <Stack gap="md">
                <Stack gap="xxs">
                    <Title order={2} size="h4">
                        Connected apps
                    </Title>
                    <Text size="sm" c="dimmed">
                        Apps you have let act as you on this station, such as a Claude connector. Each can do what you can.
                    </Text>
                </Stack>
                {grants.error ? (
                    <ErrorAlert title="Apps unavailable" error={grants.error} fallback="The station could not list your connected apps." />
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
    const revoke = useRevokeOAuthGrant();
    const [confirming, setConfirming] = useState(false);
    const name = grant.clientName ?? grant.clientId;

    return (
        <Group justify="space-between" wrap="nowrap" align="flex-start">
            <Stack gap={2}>
                <Text size="sm">{name}</Text>
                <Text size="xs" c="dimmed">
                    {`Connected ${formatDate(grant.createdAt)}`}
                    {grant.lastUsedAt ? ` · last used ${formatDate(grant.lastUsedAt)}` : ''}
                </Text>
            </Stack>
            <Button variant="subtle" color="red" size="compact-sm" onClick={() => setConfirming(true)}>
                Disconnect
            </Button>
            <ConfirmModal
                opened={confirming}
                onClose={() => setConfirming(false)}
                onConfirm={() =>
                    void revoke.mutateAsync(grant.id).then(() => {
                        setConfirming(false);
                        notifyDone(`${name} disconnected.`);
                    })
                }
                title={`Disconnect ${name}?`}
                confirmLabel="Disconnect"
                confirming={revoke.isPending}
                error={revoke.error}
                errorTitle="Still connected"
                errorFallback="The app is still connected."
            >
                {`${name} stops working as you straight away. You can connect it again later, and you will be asked to approve it again.`}
            </ConfirmModal>
        </Group>
    );
}
