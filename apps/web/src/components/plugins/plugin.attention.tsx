import { Anchor, Group, Stack, Text } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import type { PluginSummary } from '@deadair/sdk';

import { ErrorAlert } from '../shared/error.alert';
import { firstLine, needsAttention } from './plugin.roles';
import { PluginStatusLamp, statusOf } from './plugin.status';

/**
 * Every plugin that is failing or waiting on its configuration, above the groups.
 *
 * ## Why it is its own strip
 *
 * The cards are filed by what a plugin does and sorted by name, so a broken speech engine sat
 * somewhere in the middle of Voice with a red edge and nothing else to find it by. Sorting broken
 * cards to the front would have found it, and moved a card out from under the switch the moment
 * the operator toggled it. So the groups stay still and the problems are repeated up here, one row
 * each, with the error that explains them.
 *
 * Amber rather than red: the page works, and the station is still on air without the plugin.
 */
export function PluginAttentionStrip({ plugins }: { plugins: PluginSummary[] }) {
    const troubled = plugins.filter(needsAttention).sort((a, b) => a.name.localeCompare(b.name));
    if (troubled.length === 0) return undefined;

    const title = troubled.length === 1 ? '1 plugin needs attention' : `${troubled.length} plugins need attention`;

    return (
        <ErrorAlert tone="warning" title={title}>
            <Stack gap={6}>
                {troubled.map(plugin => (
                    <Group key={plugin.id} gap="xs" align="baseline">
                        <PluginStatusLamp status={plugin.status} />
                        <Anchor
                            size="sm"
                            fw={600}
                            style={{ flexShrink: 0 }}
                            renderRoot={(props: object) => <Link to="/plugins/$id" params={{ id: plugin.id }} {...props} />}
                        >
                            {plugin.name}
                        </Anchor>
                        {/* A row that wraps, with the reason clamped, rather than one that truncates: the
                            alert's body sizes itself to its content, so a no-wrap row ran the sentence off
                            the edge of a phone instead of ending it in an ellipsis. */}
                        <Text size="sm" c="dimmed" lineClamp={1} title={plugin.lastError}>
                            {plugin.lastError === undefined ? statusOf(plugin.status).description : firstLine(plugin.lastError)}
                        </Text>
                    </Group>
                ))}
            </Stack>
        </ErrorAlert>
    );
}
