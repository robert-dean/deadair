import { Alert, Button, Card, Code, CopyButton, Group, Stack, Text, Title } from '@mantine/core';
import type { PluginDetail } from '@deadair/sdk';

import { useStartPluginOAuth } from '../../api/plugins.queries';
import { apiErrorMessage, sdkError } from '../../api/sdk.error';

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
    const callbackUrl = consoleCallbackUrl(plugin.id);

    async function connect(): Promise<void> {
        try {
            const { url } = await start.mutateAsync();
            window.location.assign(url);
        } catch {
            // Reported from `start.error` below.
        }
    }

    return (
        <Card withBorder padding="lg" radius="sm">
            <Stack gap="md">
                <Stack gap={4}>
                    <Title order={3} size="h5">
                        Connection
                    </Title>
                    <Text size="sm" c="dimmed">
                        This plugin signs in to its provider on your behalf. The tokens it receives are stored encrypted and never shown here.
                    </Text>
                </Stack>

                <Stack gap={6}>
                    <Text size="sm" fw={500}>
                        Console callback URL
                    </Text>
                    <Group gap="xs" wrap="nowrap">
                        <Code style={{ overflowWrap: 'anywhere' }}>{callbackUrl}</Code>
                        <CopyButton value={callbackUrl}>
                            {({ copied, copy }) => (
                                <Button variant="subtle" size="compact-xs" onClick={copy}>
                                    {copied ? 'Copied' : 'Copy'}
                                </Button>
                            )}
                        </CopyButton>
                    </Group>
                    <Text size="xs" c="dimmed">
                        Register this with the provider, character for character, and enter it in the plugin&apos;s redirect URI setting above.
                    </Text>
                </Stack>

                {start.error ? (
                    <Alert color="red" title="Could not start the authorization">
                        {connectError(start.error)}
                    </Alert>
                ) : undefined}

                <Group justify="flex-end">
                    <Button
                        variant="default"
                        loading={start.isPending}
                        onClick={() => {
                            void connect();
                        }}
                    >
                        Connect
                    </Button>
                </Group>
            </Stack>
        </Card>
    );
}
