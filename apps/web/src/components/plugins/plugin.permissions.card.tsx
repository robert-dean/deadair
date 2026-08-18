import { Card, Divider, Group, Stack, Text, Title } from '@mantine/core';
import type { PluginSummary } from '@deadair/sdk';

import { StatusLamp } from '../shared/status.lamp';
import { GRANT_TONES, GRANT_WORDS, GrantAnswer, GrantDescription, usePluginGrantsFor } from './plugin.grants';

export interface PluginPermissionsCardProps {
    plugin: PluginSummary;
}

/**
 * What this plugin has asked the station for, answered here rather than only in the settings page.
 *
 * The same rows the settings table draws, through the same shared control, on the page an operator
 * is already on when they are trying to make this plugin work. The settings page is where you find
 * out that SOMETHING is waiting; this is where you are when you know which plugin it is.
 *
 * Above the settings form deliberately. A refused capability makes a plugin behave as though it were
 * misconfigured — the RSS reader answers headlines with no stories — so an operator arriving to
 * check the configuration should meet the unanswered question before they start rewriting settings
 * that were never wrong.
 *
 * Draws nothing for a plugin that asked for nothing, which is almost all of them: the manifest's own
 * declarations are disclosure and need no answer, and a heading over an empty card invites somebody
 * to look for a permission that does not exist.
 */
export function PluginPermissionsCard({ plugin }: PluginPermissionsCardProps) {
    const grants = usePluginGrantsFor(plugin.id);
    if (grants.length === 0) return undefined;

    return (
        <Card padding="lg">
            <Stack gap="md">
                <Stack gap="xxs">
                    <Title order={3} size="h5">
                        What this plugin has asked for
                    </Title>
                    <Text size="sm" c="dimmed">
                        It reaches only the addresses its manifest names and the ones you gave it. These are the things it has asked for on top of
                        that, and none of them apply until you say so.
                    </Text>
                </Stack>
                <Divider />

                {grants.map(grant => (
                    <Group key={grant.capability} justify="space-between" align="flex-start" wrap="nowrap" gap="lg">
                        <Stack gap="xxs">
                            <GrantDescription grant={grant} />
                            <StatusLamp tone={GRANT_TONES[grant.decision]} label={GRANT_WORDS[grant.decision]} />
                        </Stack>
                        <GrantAnswer grant={grant} />
                    </Group>
                ))}
            </Stack>
        </Card>
    );
}
