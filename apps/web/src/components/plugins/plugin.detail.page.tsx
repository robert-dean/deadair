import { Anchor, Badge, Button, Card, Divider, Group, Stack, Switch, Text, Title } from '@mantine/core';
import { IconArrowLeft } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { pluginDetailOptions, useSetPluginEnabled, useTestPlugin } from '../../api/plugins.queries';
import { apiErrorMessage } from '../../api/sdk.error';
import { ErrorAlert } from '../shared/error.alert';
import { PageHeader } from '../shared/page.header';
import { PluginConfigForm } from './plugin.config.form';
import { PluginLogsCard } from './plugin.logs.card';
import { PluginOAuthCard } from './plugin.oauth.card';
import { PluginPermissionsCard } from './plugin.permissions.card';
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
                <ErrorAlert title="Plugin unavailable" error={plugin.error} fallback={`No plugin with the id "${id}" answered.`} />
                <Anchor renderRoot={props => <Link to="/plugins" {...props} />} size="sm">
                    Back to plugins
                </Anchor>
            </Stack>
        );
    }

    const detail = plugin.data;
    const status = statusOf(detail.status);

    return (
        <Stack gap="lg" maw={720}>
            {/* `renderRoot` rather than `component={Link}`: the polymorphic form erases the
                router's own types, and with them the check that this route still exists. */}
            <Anchor renderRoot={props => <Link to="/plugins" {...props} />} size="sm">
                <Group gap={4} wrap="nowrap">
                    <IconArrowLeft size={14} stroke={1.8} />
                    Plugins
                </Group>
            </Anchor>

            <Stack gap="xs">
                <PageHeader
                    title={detail.name}
                    description={
                        <Text size="sm" c="dimmed" ff="monospace">
                            {detail.id} · {detail.version}
                        </Text>
                    }
                    actions={
                        <Switch
                            checked={detail.enabled}
                            disabled={setEnabled.isPending}
                            label={detail.enabled ? 'Enabled' : 'Disabled'}
                            aria-label={`Enable ${detail.name}`}
                            onChange={event => {
                                setEnabled.mutate({ id: detail.id, enabled: event.currentTarget.checked });
                            }}
                        />
                    }
                >
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
                </PageHeader>

                {setEnabled.error ? (
                    <ErrorAlert title="That change could not be applied" error={setEnabled.error} fallback="The plugin was left as it was." />
                ) : undefined}

                {detail.lastError ? (
                    <ErrorAlert title="Last error">
                        <Text size="sm" ff="monospace" style={{ overflowWrap: 'anywhere' }}>
                            {detail.lastError}
                        </Text>
                    </ErrorAlert>
                ) : undefined}
            </Stack>

            <Card padding="lg">
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

            {/* Before the settings form: a refused capability makes a plugin behave as though it
                were misconfigured, so the unanswered question should be met before an operator
                starts rewriting settings that were never wrong. */}
            <PluginPermissionsCard plugin={detail} />

            <Card padding="lg">
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

            <PluginLogsCard plugin={detail} />
        </Stack>
    );
}
