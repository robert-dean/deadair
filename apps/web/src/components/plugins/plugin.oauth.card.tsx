import { useState } from 'react';
import { Button, Card, Code, Group, Modal, Stack, Text, Title } from '@mantine/core';
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
function connectError(error: unknown): string {
    const status = sdkError(error)?.status;
    if (status === 403) return 'Connecting this plugin is not something your account is allowed to do.';
    if (status === 503) return 'The plugin is not running, so it cannot start an authorization. Check its configuration and status first.';
    if (status === 501) return 'This plugin declares OAuth but does not implement it.';
    return apiErrorMessage(error, 'The authorization could not be started.');
}

/** The failure an operator can act on, rather than the status code that produced it. */
function disconnectError(error: unknown): string {
    const status = sdkError(error)?.status;
    if (status === 403) return 'Disconnecting this plugin is not something your account is allowed to do.';
    if (status === 501) return 'This plugin declares OAuth but does not implement it.';
    return apiErrorMessage(error, 'The connection could not be removed.');
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
                        Connection
                    </Title>
                    <Text size="sm" c="dimmed">
                        This plugin signs in to its provider on your behalf. The tokens it receives are stored encrypted and never shown here.
                    </Text>
                </Stack>

                <Stack gap="xxs">
                    <Text size="sm" fw={500}>
                        Console callback URL
                    </Text>
                    <Group gap="xs" wrap="nowrap">
                        <Code style={{ overflowWrap: 'anywhere' }}>{callbackUrl}</Code>
                        <CopyButton value={callbackUrl} />
                    </Group>
                    <Text size="xs" c="dimmed">
                        Register this with the provider, character for character, and enter it in the plugin&apos;s redirect URI setting above.
                    </Text>
                </Stack>

                {connected ? (
                    <Text size="sm" fw={500} c="teal">
                        Connected
                    </Text>
                ) : undefined}

                {start.error ? <ErrorAlert title="Could not start the authorization">{connectError(start.error)}</ErrorAlert> : undefined}

                <Group justify="flex-end">
                    {connected ? (
                        <Button
                            variant="subtle"
                            color="red"
                            onClick={() => {
                                setConfirmOpen(true);
                            }}
                        >
                            Disconnect
                        </Button>
                    ) : undefined}
                    <Button
                        variant="default"
                        loading={start.isPending}
                        onClick={() => {
                            void connect();
                        }}
                    >
                        {connected ? 'Reconnect' : 'Connect'}
                    </Button>
                </Group>
            </Stack>

            {connected ? (
                <Modal opened={confirmOpen} onClose={closeConfirm} title={`Disconnect ${plugin.name}?`} centered>
                    <Stack gap="md">
                        <Text size="sm">
                            {plugin.name} will lose access to its provider until it is connected again. Anything it does that depends on that
                            connection will stop working until then.
                        </Text>
                        {disconnect.error ? <ErrorAlert title="Could not disconnect">{disconnectError(disconnect.error)}</ErrorAlert> : undefined}
                        <Group justify="flex-end">
                            <Button variant="default" onClick={closeConfirm}>
                                Cancel
                            </Button>
                            <Button
                                color="red"
                                loading={disconnect.isPending}
                                onClick={() => {
                                    void disconnectConfirmed();
                                }}
                            >
                                Disconnect
                            </Button>
                        </Group>
                    </Stack>
                </Modal>
            ) : undefined}
        </Card>
    );
}
