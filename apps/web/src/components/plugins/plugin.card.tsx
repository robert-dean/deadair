import { useState } from 'react';
import { Anchor, Badge, Card, Divider, Group, Stack, Switch, Text } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import type { PluginSummary } from '@deadair/sdk';

import { useSetPluginEnabled } from '../../api/plugins.queries';
import { apiErrorMessage } from '../../api/sdk.error';
import { severityColor, toneColor } from '../shared/status';
import { PluginStatusLamp, statusOf } from './plugin.status';
import { PluginTrustDialog } from './plugin.trust.dialog';

export interface PluginCardProps {
    plugin: PluginSummary;
}

/** One plugin in the catalogue: what it is, whether it is running, and a way in. */
export function PluginCard({ plugin }: PluginCardProps) {
    const setEnabled = useSetPluginEnabled();
    const { tone } = statusOf(plugin.status);
    const pending = setEnabled.isPending && setEnabled.variables?.id === plugin.id;
    const [trustDialogOpen, setTrustDialogOpen] = useState(false);

    return (
        <Card padding="lg" style={{ borderLeft: `2px solid var(--mantine-color-${toneColor[tone]}-5)` }}>
            <Stack gap="sm" h="100%">
                <Group justify="space-between" align="flex-start" wrap="nowrap">
                    <Stack gap="xxxs">
                        <Text fw={600} size="lg" lh={1.2}>
                            {plugin.name}
                        </Text>
                        <Text size="xs" c="dimmed" ff="monospace">
                            {plugin.id} · {plugin.version}
                        </Text>
                    </Stack>
                    <PluginStatusLamp status={plugin.status} />
                </Group>

                <Text size="sm" c="dimmed" lineClamp={2}>
                    {plugin.description ?? 'No description.'}
                </Text>

                <Group gap="xxs">
                    {plugin.capabilities.map(capability => (
                        <Badge key={capability} size="sm" variant="light" color="gray" tt="none">
                            {capability}
                        </Badge>
                    ))}
                </Group>

                {setEnabled.error && setEnabled.variables?.id === plugin.id ? (
                    <Text size="xs" c={severityColor.failure}>
                        {apiErrorMessage(setEnabled.error, 'That change could not be applied.')}
                    </Text>
                ) : undefined}

                <Divider mt="auto" />

                <Group justify="space-between">
                    <Switch
                        size="sm"
                        checked={plugin.enabled}
                        disabled={pending}
                        label={plugin.enabled ? 'Enabled' : 'Disabled'}
                        aria-label={`Enable ${plugin.name}`}
                        onChange={event => {
                            if (event.currentTarget.checked) {
                                setTrustDialogOpen(true);
                            } else {
                                setEnabled.mutate({ id: plugin.id, enabled: false });
                            }
                        }}
                    />
                    {/* `renderRoot` rather than `component={Link}`: the polymorphic form erases the
                        router's own types, and with them the check that `params` matches the path. */}
                    <Anchor renderRoot={props => <Link to="/plugins/$id" params={{ id: plugin.id }} {...props} />} size="sm">
                        Configure
                    </Anchor>
                </Group>

                <PluginTrustDialog
                    plugin={plugin}
                    opened={trustDialogOpen}
                    onCancel={() => setTrustDialogOpen(false)}
                    onConfirm={() => {
                        setTrustDialogOpen(false);
                        setEnabled.mutate({ id: plugin.id, enabled: true });
                    }}
                />
            </Stack>
        </Card>
    );
}
