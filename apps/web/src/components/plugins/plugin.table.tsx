import { Anchor, Badge, Group, Stack, Table, Text } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import type { PluginSummary } from '@deadair/sdk';

import { Eyebrow } from '../shared/eyebrow';
import { severityColor } from '../shared/status';
import { usePluginEnableToggle } from './plugin.enable.toggle';
import { capabilityLabel, firstLine, needsAttention, type PluginGroup } from './plugin.roles';
import { PluginOriginBadge, PluginStatusLamp } from './plugin.status';

const COLUMNS = 5;

/**
 * The plugin list as one table: every plugin on a screen, in the same groups the cards use.
 *
 * What it leaves out is the description and the standing lines, which are the two things that
 * make a card tall. Both are a click away on the plugin's own page, and somebody who switched to
 * this view did so to see the whole station at once rather than to read about one plugin.
 *
 * The groups are header rows rather than separate tables, so the columns line up down the page.
 */
export function PluginTable({ groups }: { groups: PluginGroup<PluginSummary>[] }) {
    return (
        <Table.ScrollContainer minWidth={760}>
            <Table layout="fixed">
                <Table.Thead>
                    <Table.Tr>
                        <Table.Th w="24%">Plugin</Table.Th>
                        <Table.Th>Does</Table.Th>
                        <Table.Th w="26%">Status</Table.Th>
                        <Table.Th w={70}>On</Table.Th>
                        <Table.Th w={90} />
                    </Table.Tr>
                </Table.Thead>
                {groups.map(({ role, plugins }) => (
                    <Table.Tbody key={role.key} aria-label={role.title}>
                        <Table.Tr>
                            <Table.Td colSpan={COLUMNS} pt="md">
                                <Eyebrow>
                                    {role.title} · {plugins.length}
                                </Eyebrow>
                            </Table.Td>
                        </Table.Tr>
                        {plugins.map(plugin => (
                            <PluginRow key={plugin.id} plugin={plugin} />
                        ))}
                    </Table.Tbody>
                ))}
            </Table>
        </Table.ScrollContainer>
    );
}

function PluginRow({ plugin }: { plugin: PluginSummary }) {
    const toggle = usePluginEnableToggle(plugin, { label: false });
    const reason = needsAttention(plugin) ? plugin.lastError : undefined;

    return (
        <Table.Tr>
            <Table.Td>
                <Stack gap={0}>
                    <Group gap="xs" wrap="nowrap">
                        <Text size="sm" fw={600} truncate="end">
                            {plugin.name}
                        </Text>
                        <PluginOriginBadge plugin={plugin} />
                    </Group>
                    <Text size="xs" c="dimmed" ff="monospace" truncate="end" title={`${plugin.id} · ${plugin.version}`}>
                        {plugin.id} · {plugin.version}
                    </Text>
                </Stack>
            </Table.Td>
            <Table.Td>
                <Group gap="xxs">
                    {plugin.capabilities.map(capability => (
                        <Badge key={capability} size="sm" variant="light" color="gray" tt="none" title={capability}>
                            {capabilityLabel(capability)}
                        </Badge>
                    ))}
                </Group>
            </Table.Td>
            <Table.Td>
                <Stack gap={2}>
                    <PluginStatusLamp status={plugin.status} />
                    {reason !== undefined ? (
                        <Text size="xs" c={severityColor.failure} truncate="end" title={reason}>
                            {firstLine(reason)}
                        </Text>
                    ) : undefined}
                    {toggle.error}
                </Stack>
            </Table.Td>
            <Table.Td>{toggle.control}</Table.Td>
            <Table.Td ta="right">
                {/* `renderRoot` rather than `component={Link}`: the polymorphic form erases the
                    router's own types, and with them the check that `params` matches the path. */}
                <Anchor renderRoot={(props: object) => <Link to="/plugins/$id" params={{ id: plugin.id }} {...props} />} size="sm">
                    Configure
                </Anchor>
            </Table.Td>
        </Table.Tr>
    );
}
