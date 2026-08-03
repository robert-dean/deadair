import { Alert, Anchor, Badge, Button, Card, Divider, Group, Stack, Switch, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { pluginDetailOptions, useSetPluginEnabled, useTestPlugin } from '../../api/plugins.queries';
import { apiErrorMessage } from '../../api/sdk.error';
import { PluginConfigForm } from './plugin.config.form';
import { PluginOAuthCard } from './plugin.oauth.card';
import { hasConfigForm, hasOAuth, PluginStatusLamp, statusOf } from './plugin.status';

export interface PluginDetailPageProps {
    id: string;
}

/** One plugin: what it is doing, why it is not doing it, and everything an operator can change. */
export function PluginDetailPage({ id }: PluginDetailPageProps) {
    const plugin = useQuery(pluginDetailOptions(id));
    const setEnabled = useSetPluginEnabled();
    const test = useTestPlugin(id);

    if (plugin.isPending) {
        return <Text c="dimmed">Loading…</Text>;
    }

    if (plugin.error || !plugin.data) {
        return (
            <Stack gap="md" align="flex-start">
                <Alert color="red" title="Plugin unavailable">
                    {apiErrorMessage(plugin.error, `No plugin with the id "${id}" answered.`)}
                </Alert>
                <Anchor component={Link} to="/plugins" size="sm">
                    Back to plugins
                </Anchor>
            </Stack>
        );
    }

    const detail = plugin.data;
    const status = statusOf(detail.status);

    return (
        <Stack gap="lg" maw={720}>
            <Anchor component={Link} to="/plugins" size="sm">
                ← Plugins
            </Anchor>

            <Stack gap="xs">
                <Group justify="space-between" align="flex-start">
                    <Stack gap={4}>
                        <Title order={1}>{detail.name}</Title>
                        <Text size="sm" c="dimmed" ff="monospace">
                            {detail.id} · {detail.version} · {detail.kind}
                        </Text>
                    </Stack>
                    <Switch
                        checked={detail.enabled}
                        disabled={setEnabled.isPending}
                        label={detail.enabled ? 'Enabled' : 'Disabled'}
                        aria-label={`Enable ${detail.name}`}
                        onChange={event => {
                            setEnabled.mutate({ id: detail.id, enabled: event.currentTarget.checked });
                        }}
                    />
                </Group>

                {detail.description ? <Text c="dimmed">{detail.description}</Text> : undefined}

                <Group gap="sm" mt="xs">
                    <PluginStatusLamp status={detail.status} size="md" />
                    <Text size="sm" c="dimmed">
                        {status.description}
                    </Text>
                </Group>

                {detail.capabilities.length > 0 ? (
                    <Group gap={6}>
                        {detail.capabilities.map(capability => (
                            <Badge key={capability} size="sm" variant="light" color="gray" tt="none">
                                {capability}
                            </Badge>
                        ))}
                    </Group>
                ) : undefined}

                {setEnabled.error ? (
                    <Alert color="red" title="That change could not be applied">
                        {apiErrorMessage(setEnabled.error, 'The plugin was left as it was.')}
                    </Alert>
                ) : undefined}

                {detail.lastError ? (
                    <Alert color="red" title="Last error">
                        <Text size="sm" ff="monospace" style={{ overflowWrap: 'anywhere' }}>
                            {detail.lastError}
                        </Text>
                    </Alert>
                ) : undefined}
            </Stack>

            <Card withBorder padding="lg" radius="sm">
                <Stack gap="md">
                    <Group justify="space-between" align="center">
                        <Stack gap={2}>
                            <Title order={3} size="h5">
                                Connection test
                            </Title>
                            <Text size="sm" c="dimmed">
                                Asks the plugin whether it can reach its provider right now.
                            </Text>
                        </Stack>
                        <Button
                            variant="default"
                            size="compact-sm"
                            loading={test.isPending}
                            onClick={() => {
                                test.mutate();
                            }}
                        >
                            Test connection
                        </Button>
                    </Group>

                    {/* `ok: false` is the answer to the question, not a failed request, so it is
                        reported in the same place a success would be. */}
                    {test.data ? (
                        <Text size="sm" c={test.data.ok ? 'teal' : 'red'}>
                            {test.data.ok ? (test.data.message ?? 'Connected.') : (test.data.message ?? 'The plugin could not connect.')}
                        </Text>
                    ) : undefined}
                    {test.error ? (
                        <Text size="sm" c="red">
                            {apiErrorMessage(test.error, 'The test could not be run.')}
                        </Text>
                    ) : undefined}
                </Stack>
            </Card>

            <Card withBorder padding="lg" radius="sm">
                <Stack gap="md">
                    <Stack gap={4}>
                        <Title order={3} size="h5">
                            Settings
                        </Title>
                        <Text size="sm" c="dimmed">
                            Saving reinitializes the plugin, so a change takes effect without restarting the station.
                        </Text>
                    </Stack>
                    <Divider />
                    {hasConfigForm(detail) ? (
                        <PluginConfigForm plugin={detail} />
                    ) : (
                        <Text size="sm" c="dimmed">
                            This plugin exposes no settings.
                        </Text>
                    )}
                </Stack>
            </Card>

            {hasOAuth(detail) ? <PluginOAuthCard plugin={detail} /> : undefined}
        </Stack>
    );
}
