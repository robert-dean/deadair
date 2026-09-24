import { Anchor, Badge, Card, Divider, Group, Stack, Text } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import type { PluginSummary } from '@deadair/sdk';

import { severityColor, toneColor } from '../shared/status';
import { usePluginEnableToggle } from './plugin.enable.toggle';
import { capabilityLabel, firstLine, needsAttention } from './plugin.roles';
import { PluginStanding } from './plugin.standing';
import { PluginOriginBadge, PluginStatusLamp, statusOf } from './plugin.status';

export interface PluginCardProps {
    plugin: PluginSummary;
}

/** One plugin in the catalogue: what it is, whether it is running, and a way in. */
export function PluginCard({ plugin }: PluginCardProps) {
    const { tone } = statusOf(plugin.status);
    const toggle = usePluginEnableToggle(plugin);

    return (
        <Card padding="md" style={{ borderLeft: `2px solid var(--mantine-color-${toneColor[tone]}-5)` }}>
            <Stack gap="xs" h="100%">
                <Group justify="space-between" align="flex-start" wrap="nowrap">
                    <Stack gap="xxxs">
                        <Text fw={600} lh={1.2}>
                            {plugin.name}
                        </Text>
                        <Text size="xs" c="dimmed" ff="monospace">
                            {plugin.id} · {plugin.version}
                        </Text>
                    </Stack>
                    <Group gap="xs" wrap="nowrap">
                        <PluginOriginBadge plugin={plugin} />
                        <PluginStatusLamp status={plugin.status} />
                    </Group>
                </Group>

                <Text size="sm" c="dimmed" lineClamp={2}>
                    {plugin.description ?? 'No description.'}
                </Text>

                {/* The first line only: the full text and its history are on the plugin's own page,
                    and a stack trace here would push the switch off the bottom of the card. */}
                {needsAttention(plugin) && plugin.lastError !== undefined ? (
                    <Text size="xs" c={severityColor.failure} lineClamp={1} title={plugin.lastError}>
                        {firstLine(plugin.lastError)}
                    </Text>
                ) : undefined}

                <Group gap="xxs">
                    {plugin.capabilities.map(capability => (
                        <Badge key={capability} size="sm" variant="light" color="gray" tt="none" title={capability}>
                            {capabilityLabel(capability)}
                        </Badge>
                    ))}
                </Group>

                {/* What those badges leave out: whether anything else claims the same job, and
                    which of them the station actually reaches. Nothing is drawn for a capability
                    only this plugin can do. */}
                <PluginStanding pluginId={plugin.id} />

                {toggle.error}

                <Divider mt="auto" />

                <Group justify="space-between">
                    {toggle.control}
                    {/* `renderRoot` rather than `component={Link}`: the polymorphic form erases the
                        router's own types, and with them the check that `params` matches the path. */}
                    <Anchor renderRoot={(props: object) => <Link to="/plugins/$id" params={{ id: plugin.id }} {...props} />} size="sm">
                        Configure
                    </Anchor>
                </Group>
            </Stack>
        </Card>
    );
}
