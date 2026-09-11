import { Badge } from '@mantine/core';
import type { PluginStatus, PluginSummary } from '@deadair/sdk';

import type { StatusTone } from '../shared/status';
import { StatusLamp } from '../shared/status.lamp';

/** The capability a plugin declares when it can walk an operator through a provider's consent screen. */
export const OAUTH_CAPABILITY = 'oauth';

interface StatusDescriptor {
    label: string;
    /** What KIND of state this is, in the console's one status vocabulary. */
    tone: StatusTone;
    /** One sentence an operator can act on, shown under the status on the detail page. */
    description: string;
}

/**
 * The single reading of `PluginStatus`. Every surface that colours or explains a status goes
 * through here, so a card and a detail header cannot disagree about what `misconfigured` means.
 *
 * The colour itself is no longer named here: a tone is, and `shared/status.ts` maps it, so a
 * plugin that failed and a station that went off air are the same red for the same reason.
 */
export const PLUGIN_STATUS: Record<PluginStatus, StatusDescriptor> = {
    active: { label: 'Active', tone: 'ok', description: 'Running and available to the station.' },
    disabled: { label: 'Disabled', tone: 'off', description: 'Switched off. Its configuration is kept.' },
    misconfigured: { label: 'Misconfigured', tone: 'fault', description: 'Installed, but its settings are incomplete or rejected.' },
    failed: { label: 'Failed', tone: 'live', description: 'The host could not start it. See the error below.' },
    discovered: { label: 'Discovered', tone: 'standby', description: 'Found on disk and not yet started.' },
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

/**
 * Whether this plugin's records are fetched through the station's own track fetcher, which is what
 * earns it the playback authorization card.
 *
 * Not the `stream` capability, which is what this read until Navidrome showed why not: that only
 * says a plugin can put a record on air, and Navidrome does it by minting its own URLs, so its page
 * offered a Spotify fetcher login it has no use for. And not a plugin id either, because what earns
 * the card is feeding the fetcher, and a second provider that did would want the same card.
 */
export function feedsTrackFetcher(plugin: PluginSummary): boolean {
    return plugin.usesTrackFetcher === true;
}

export interface PluginStatusProps {
    status: PluginStatus;
    size?: 'sm' | 'md';
}

/** A lamp and a word. Deliberately not a chip: status is the quietest thing on a busy card. */
export function PluginStatusLamp({ status, size = 'sm' }: PluginStatusProps) {
    const { label, tone } = statusOf(status);
    return <StatusLamp tone={tone} label={label} size={size} />;
}

export interface PluginOriginBadgeProps {
    plugin: Pick<PluginSummary, 'origin'>;
}

/**
 * Marks a plugin the operator installed, as against one the image shipped with. Drawn only for the
 * installed kind: the bundled set is the ordinary case, and a badge on every card would say nothing.
 * It is a fact about where the code came from and never a trust level, since both run as the station.
 */
export function PluginOriginBadge({ plugin }: PluginOriginBadgeProps) {
    if (plugin.origin !== 'installed') return undefined;
    return (
        <Badge size="xs" variant="outline" color="gray" tt="none" title="Added to the plugins folder on this station, not shipped with it">
            Installed
        </Badge>
    );
}
