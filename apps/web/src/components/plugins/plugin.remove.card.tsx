import { useState } from 'react';
import { Button, Card, Group, Modal, Stack, Text, Title } from '@mantine/core';
import { useNavigate } from '@tanstack/react-router';
import type { PluginDetail } from '@deadair/sdk';

import { useRemovePlugin } from '../../api/plugins.queries';
import { apiErrorMessage, sdkError } from '../../api/sdk.error';
import { ErrorAlert } from '../shared/error.alert';
import { notifyDone } from '../shared/notify';

export interface PluginRemoveCardProps {
    plugin: Pick<PluginDetail, 'id' | 'name'>;
}

/**
 * Taking a plugin the operator installed back off the station.
 *
 * Drawn only for an installed plugin: a bundled one has no folder of its own and comes back with the
 * station, so the way to stop one is its switch. The dialog says what is kept as plainly as what is
 * deleted, because the settings surviving is the part nobody would guess, and it is the part that
 * makes importing it again cheap.
 */
export function PluginRemoveCard({ plugin }: PluginRemoveCardProps) {
    const remove = useRemovePlugin();
    const navigate = useNavigate();
    const [confirmOpen, setConfirmOpen] = useState(false);

    const closeConfirm = () => {
        setConfirmOpen(false);
        remove.reset();
    };

    const confirmed = async () => {
        const done = await remove.mutateAsync(plugin.id).then(
            () => true,
            () => false,
        );
        if (!done) return;
        notifyDone(`${plugin.name} removed.`);
        void navigate({ to: '/plugins' });
    };

    return (
        <Card padding="lg">
            <Group justify="space-between" align="center">
                <Stack gap="xxxs">
                    <Title order={3} size="h5">
                        Remove
                    </Title>
                    <Text size="sm" c="dimmed">
                        Deletes this plugin&apos;s folder from the station. Its settings are kept.
                    </Text>
                </Stack>
                <Button variant="subtle" color="red" onClick={() => setConfirmOpen(true)}>
                    Remove
                </Button>
            </Group>

            <Modal opened={confirmOpen} onClose={closeConfirm} title={`Remove ${plugin.name}?`} centered>
                <Stack gap="md">
                    <Text size="sm">
                        {plugin.name} stops, and its folder on the station is deleted. Its settings and what it was allowed are kept, so importing it
                        again brings them back.
                    </Text>
                    {remove.error ? <ErrorAlert title="That plugin was not removed">{removeError(remove.error)}</ErrorAlert> : undefined}
                    <Group justify="flex-end">
                        <Button variant="default" onClick={closeConfirm}>
                            Cancel
                        </Button>
                        <Button color="red" loading={remove.isPending} onClick={() => void confirmed()}>
                            Remove {plugin.name}
                        </Button>
                    </Group>
                </Stack>
            </Modal>
        </Card>
    );
}

/** What a refused removal means, in the operator's terms. */
function removeError(error: unknown): string {
    if (sdkError(error)?.status === 403) return 'Removing a plugin is an administrator action.';
    return apiErrorMessage(error, 'The plugin could not be removed.');
}
