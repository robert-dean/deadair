import { Box, Group, Text } from '@mantine/core';
import type { PluginStatus, PluginSummary } from '@deadair/sdk';

/** The capability a plugin declares when it can walk an operator through a provider's consent screen. */
export const OAUTH_CAPABILITY = 'oauth';

interface StatusDescriptor {
    label: string;
    /** A Mantine palette name, used for the dot, the card's edge and any badge. */
    color: string;
    /** One sentence an operator can act on, shown under the status on the detail page. */
    description: string;
}

/**
 * The single reading of `PluginStatus`. Every surface that colours or explains a status goes
 * through here, so a card and a detail header cannot disagree about what `misconfigured` means.
 */
export const PLUGIN_STATUS: Record<PluginStatus, StatusDescriptor> = {
    active: { label: 'Active', color: 'teal', description: 'Running and available to the station.' },
    disabled: { label: 'Disabled', color: 'gray', description: 'Switched off. Its configuration is kept.' },
    misconfigured: { label: 'Misconfigured', color: 'yellow', description: 'Installed, but its settings are incomplete or rejected.' },
    failed: { label: 'Failed', color: 'red', description: 'The host could not start it. See the error below.' },
    discovered: { label: 'Discovered', color: 'blue', description: 'Found on disk and not yet started.' },
};

export function statusOf(status: PluginStatus): StatusDescriptor {
    return PLUGIN_STATUS[status];
}

/**
 * Whether the plugin has a settings form to render.
 *
 * A plugin whose manifest never loaded reports no config fields at all, and there is nothing
 * useful to show an operator beyond the failure itself.
 */
export function hasConfigForm(plugin: PluginSummary): boolean {
    return plugin.configFields.length > 0;
}

export function hasOAuth(plugin: PluginSummary): boolean {
    return plugin.capabilities.includes(OAUTH_CAPABILITY);
}

export interface PluginStatusProps {
    status: PluginStatus;
    size?: 'sm' | 'md';
}

/** A lamp and a word. Deliberately not a Badge: status is the quietest thing on a busy card. */
export function PluginStatusLamp({ status, size = 'sm' }: PluginStatusProps) {
    const { label, color } = statusOf(status);
    const dot = size === 'md' ? 10 : 8;
    return (
        <Group gap={7} wrap="nowrap" aria-label={`Status: ${label}`}>
            <Box w={dot} h={dot} bg={`${color}.5`} style={{ borderRadius: '50%', flexShrink: 0 }} />
            <Text size={size === 'md' ? 'sm' : 'xs'} fw={600} tt="uppercase" style={{ letterSpacing: '0.06em' }}>
                {label}
            </Text>
        </Group>
    );
}
