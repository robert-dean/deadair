import type { PluginSummary } from '@deadair/sdk';

import { i18n } from '../../i18n/i18n.setup';

/**
 * What each capability id means to an operator, for the badges on a plugin card.
 *
 * The ids are the manifest's vocabulary and read like one: `enrichment`, `steer`, `oauth`. A card
 * is where an operator decides whether they want a plugin at all, so it says what the plugin does
 * for the station and keeps the id in the badge's title for anybody matching it to a manifest.
 * An id missing from here is shown as itself, which is what an installed plugin declaring a
 * capability this console has never heard of should get.
 */
export const KNOWN_CAPABILITIES = [
    'catalog',
    'stream',
    'steer',
    'speech',
    'llm',
    'analysis',
    'mixer',
    'enrichment',
    'similarity',
    'search',
    'scrobble',
    'news',
    'weather',
    'podcast',
    'almanac',
    'charts',
    'oauth',
] as const;

type KnownCapability = (typeof KNOWN_CAPABILITIES)[number];

function isKnownCapability(capability: string): capability is KnownCapability {
    return (KNOWN_CAPABILITIES as readonly string[]).includes(capability);
}

/** The label from the plugins catalog (`capability.<id>`), or the id itself when this console has never heard of it. */
export function capabilityLabel(capability: string): string {
    return isKnownCapability(capability) ? i18n.t(`capability.${capability}`, { ns: 'plugins' }) : capability;
}

type RoleKey = 'music' | 'voice' | 'writing' | 'audio' | 'knowledge' | 'programmes' | 'other';

export interface PluginRole {
    key: RoleKey;
    /** Read from the plugins catalog (`roles.<key>`) each time, so it is in the console's current language. */
    readonly title: string;
    /** The capabilities that put a plugin in this group, when no earlier group has claimed it. */
    capabilities: readonly string[];
}

/**
 * The groups the plugin list is drawn in, in the order they are drawn.
 *
 * A plugin sits in exactly one: the FIRST whose capabilities it shares. So the order is also the
 * tie-break, and it runs from the jobs a station cannot air without to the ones that colour what
 * it says. Last.fm does enrichment, charts, similarity and scrobbling, and is filed under
 * Knowledge because that group comes first; its other jobs are still on its badges.
 */
export const PLUGIN_ROLES: readonly PluginRole[] = [
    role('music', ['catalog', 'stream']),
    role('voice', ['speech']),
    role('writing', ['llm']),
    role('audio', ['analysis', 'mixer']),
    role('knowledge', ['enrichment', 'similarity', 'search', 'scrobble']),
    role('programmes', ['news', 'weather', 'podcast', 'almanac', 'charts']),
];

/** Where a plugin goes when it declares nothing any group above claims. Never empty-handed. */
export const OTHER_ROLE: PluginRole = role('other', []);

function role(key: RoleKey, capabilities: readonly string[]): PluginRole {
    return {
        key,
        get title() {
            return i18n.t(`roles.${key}`, { ns: 'plugins' });
        },
        capabilities,
    };
}

export function roleOf(plugin: Pick<PluginSummary, 'capabilities'>): PluginRole {
    return PLUGIN_ROLES.find(role => role.capabilities.some(capability => plugin.capabilities.includes(capability))) ?? OTHER_ROLE;
}

export interface PluginGroup<T extends Pick<PluginSummary, 'capabilities' | 'name'>> {
    role: PluginRole;
    plugins: T[];
}

/**
 * The plugins filed under their roles: groups in `PLUGIN_ROLES` order with `Other` last, each
 * sorted by name, and a group with nobody in it left out rather than drawn as an empty heading.
 *
 * By name rather than by status on purpose. A card that moved every time its plugin was toggled
 * would jump out from under the switch that moved it; what is broken is surfaced above the groups
 * instead, where it does not reorder anything.
 */
export function groupByRole<T extends Pick<PluginSummary, 'capabilities' | 'name'>>(plugins: readonly T[]): PluginGroup<T>[] {
    return [...PLUGIN_ROLES, OTHER_ROLE]
        .map(role => ({
            role,
            plugins: plugins.filter(plugin => roleOf(plugin) === role).sort((a, b) => a.name.localeCompare(b.name)),
        }))
        .filter(group => group.plugins.length > 0);
}

/**
 * Whether a plugin is in a state the operator has to do something about.
 *
 * `disabled` is not one: switching a plugin off is a decision, and a page that listed every
 * decision as a problem would be one nobody reads twice.
 */
export function needsAttention(plugin: Pick<PluginSummary, 'status'>): boolean {
    return plugin.status === 'failed' || plugin.status === 'misconfigured';
}

/**
 * The first line of a failure, which is the part that fits on a row or a card. Anything after it
 * is usually a stack, and belongs in a title attribute or on the plugin's own page.
 */
export function firstLine(text: string): string {
    return text.split('\n', 1)[0] ?? text;
}
