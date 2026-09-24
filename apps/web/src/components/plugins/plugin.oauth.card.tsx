import { useState } from 'react';
import { Button, Card, Code, Group, Modal, Stack, Text, Title } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { PluginDetail } from '@deadair/sdk';

import { useDisconnectPluginOAuth, useStartPluginOAuth } from '../../api/plugins.queries';
import { apiErrorMessage, sdkError } from '../../api/sdk.error';
import { CopyButton } from '../shared/copy.button';
import { ErrorAlert } from '../shared/error.alert';

/** Where the provider should send the operator back to. The console completes the flow, not the API. */
export function consoleCallbackUrl(pluginId: string): string {
    return `${window.location.origin}/plugins/${encodeURIComponent(pluginId)}/oauth/callback`;
}

/** The failure an operator can act on, rather than the status code that produced it. */
function connectError(error: unknown, t: TFunction<'plugins'>): string {
    const status = sdkError(error)?.status;
    if (status === 403) return t('oauth.connectError.forbidden');
    if (status === 503) return t('oauth.connectError.notRunning');
    if (status === 501) return t('oauth.notImplemented');
    return apiErrorMessage(error, t('oauth.connectError.fallback'));
}

/** The failure an operator can act on, rather than the status code that produced it. */
function disconnectError(error: unknown, t: TFunction<'plugins'>): string {
    const status = sdkError(error)?.status;
    if (status === 403) return t('oauth.disconnectError.forbidden');
    if (status === 501) return t('oauth.notImplemented');
    return apiErrorMessage(error, t('oauth.disconnectError.fallback'));
}

export interface PluginOAuthCardProps {
    plugin: PluginDetail;
}

/**
 * The consent leg of a plugin's setup.
 *
 * The API reports the provider's URL rather than redirecting to it — the route is behind the
 * session, and a browser sent there top-level carries no token — so the navigation happens here,
 * where the session lives.
 */
export function PluginOAuthCard({ plugin }: PluginOAuthCardProps) {
    const { t } = useTranslation(['plugins', 'common']);
    const start = useStartPluginOAuth(plugin.id);
    const disconnect = useDisconnectPluginOAuth(plugin.id);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const callbackUrl = consoleCallbackUrl(plugin.id);
    const connected = plugin.oauthConnected === true;

    async function connect(): Promise<void> {
        try {
            const { url } = await start.mutateAsync();
            window.location.assign(url);
        } catch {
            // Reported from `start.error` below.
        }
    }

    /**
     * Closing discards the failure along with the modal. Without the reset, a
     * dismissed error is still in the mutation when the operator reopens, so a
     * stale Alert greets them before they have pressed anything.
     */
    function closeConfirm(): void {
        setConfirmOpen(false);
        disconnect.reset();
    }

    async function disconnectConfirmed(): Promise<void> {
        try {
            await disconnect.mutateAsync();
            setConfirmOpen(false);
        } catch {
            // The modal stays open and reports the failure via `disconnect.error` in the Alert inside it.
        }
    }

    return (
        <Card padding="lg">
            <Stack gap="md">
                <Stack gap="xxs">
                    <Title order={3} size="h5">
                        {t('oauth.title')}
                    </Title>
                    <Text size="sm" c="dimmed">
                        {t('oauth.description')}
                    </Text>
                </Stack>

                <Stack gap="xxs">
                    <Text size="sm" fw={500}>
                        {t('oauth.callbackUrl')}
                    </Text>
                    <Group gap="xs" wrap="nowrap">
                        <Code style={{ overflowWrap: 'anywhere' }}>{callbackUrl}</Code>
                        <CopyButton value={callbackUrl} />
                    </Group>
                    <Text size="xs" c="dimmed">
                        {t('oauth.callbackHint')}
                    </Text>
                </Stack>

                {connected ? (
                    <Text size="sm" fw={500} c="teal">
                        {t('oauth.connected')}
                    </Text>
                ) : undefined}

                {start.error ? <ErrorAlert title={t('oauth.connectError.title')}>{connectError(start.error, t)}</ErrorAlert> : undefined}

                <Group justify="flex-end">
                    {connected ? (
                        <Button
                            variant="subtle"
                            color="red"
                            onClick={() => {
                                setConfirmOpen(true);
                            }}
                        >
                            {t('oauth.disconnect')}
                        </Button>
                    ) : undefined}
                    <Button
                        variant="default"
                        loading={start.isPending}
                        onClick={() => {
                            void connect();
                        }}
                    >
                        {connected ? t('oauth.reconnect') : t('oauth.connect')}
                    </Button>
                </Group>
            </Stack>

            {connected ? (
                <Modal opened={confirmOpen} onClose={closeConfirm} title={t('oauth.confirm.title', { name: plugin.name })} centered>
                    <Stack gap="md">
                        <Text size="sm">{t('oauth.confirm.body', { name: plugin.name })}</Text>
                        {disconnect.error ? (
                            <ErrorAlert title={t('oauth.disconnectError.title')}>{disconnectError(disconnect.error, t)}</ErrorAlert>
                        ) : undefined}
                        <Group justify="flex-end">
                            <Button variant="default" onClick={closeConfirm}>
                                {t('common:action.cancel')}
                            </Button>
                            <Button
                                color="red"
                                loading={disconnect.isPending}
                                onClick={() => {
                                    void disconnectConfirmed();
                                }}
                            >
                                {t('oauth.disconnect')}
                            </Button>
                        </Group>
                    </Stack>
                </Modal>
            ) : undefined}
        </Card>
    );
}
