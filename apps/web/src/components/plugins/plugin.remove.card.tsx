import { useState } from 'react';
import { Button, Card, Group, Modal, Stack, Text, Title } from '@mantine/core';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { PluginDetail } from '@deadair/sdk';

import { useRemovePlugin } from '../../api/plugins.queries';
import { apiErrorMessage, sdkError } from '../../api/sdk.error';
import { ErrorAlert } from '../shared/error.alert';
import { notifyDone } from '../shared/notify';
import { PLUGINS_PAGE_DEFAULTS } from './plugin.page.params';

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
    const { t } = useTranslation(['plugins', 'common']);
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
        notifyDone(t('remove.done', { name: plugin.name }));
        void navigate({ to: '/plugins', search: PLUGINS_PAGE_DEFAULTS });
    };

    return (
        <Card padding="lg">
            <Group justify="space-between" align="center">
                <Stack gap="xxxs">
                    <Title order={3} size="h5">
                        {t('remove.title')}
                    </Title>
                    <Text size="sm" c="dimmed">
                        {t('remove.description')}
                    </Text>
                </Stack>
                <Button variant="subtle" color="red" onClick={() => setConfirmOpen(true)}>
                    {t('remove.button')}
                </Button>
            </Group>

            <Modal opened={confirmOpen} onClose={closeConfirm} title={t('remove.confirm.title', { name: plugin.name })} centered>
                <Stack gap="md">
                    <Text size="sm">{t('remove.confirm.body', { name: plugin.name })}</Text>
                    {remove.error ? <ErrorAlert title={t('remove.error.title')}>{removeError(remove.error, t)}</ErrorAlert> : undefined}
                    <Group justify="flex-end">
                        <Button variant="default" onClick={closeConfirm}>
                            {t('common:action.cancel')}
                        </Button>
                        <Button color="red" loading={remove.isPending} onClick={() => void confirmed()}>
                            {t('remove.confirm.button', { name: plugin.name })}
                        </Button>
                    </Group>
                </Stack>
            </Modal>
        </Card>
    );
}

/** What a refused removal means, in the operator's terms. */
function removeError(error: unknown, t: TFunction<'plugins'>): string {
    if (sdkError(error)?.status === 403) return t('remove.error.forbidden');
    return apiErrorMessage(error, t('remove.error.fallback'));
}
