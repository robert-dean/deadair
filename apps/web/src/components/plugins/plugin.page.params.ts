import type { PluginSummary } from '@deadair/sdk';

import { capabilityLabel, needsAttention, roleOf } from './plugin.roles';

/**
 * Which plugins the list is narrowed to. `attention` is failed or misconfigured, whether or not it
 * is switched on: a misconfigured plugin is often off BECAUSE it is misconfigured.
 */
export const PLUGIN_SHOWS = ['all', 'enabled', 'attention', 'disabled'] as const;

export type PluginShow = (typeof PLUGIN_SHOWS)[number];

/**
 * Where the plugin list keeps its search term and status filter: the URL, as the catalog lists do,
 * so "the plugins that need attention" is a link somebody can send and the back button undoes a
 * filter rather than leaving the page.
 */
export interface PluginsPageParams {
    /** Empty means unfiltered. Never undefined, so the page has one shape to handle. */
    q: string;
    show: PluginShow;
}

/** What the route strips back out of the URL, so the list at rest has no query string at all. */
export const PLUGINS_PAGE_DEFAULTS: PluginsPageParams = { q: '', show: 'all' };

/** Anything unrecognised falls back rather than throwing: a hand-typed link should land on the list. */
export function validatePluginsPage(input: Record<string, unknown>): PluginsPageParams {
    return {
        q: typeof input.q === 'string' ? input.q : '',
        show: PLUGIN_SHOWS.find(known => known === input.show) ?? 'all',
    };
}

/**
 * Whether a plugin answers to a search term.
 *
 * Over what the card SAYS as well as what the plugin is called: its capability labels and its
 * group, so "voice" finds every speech engine though none of them is named that.
 */
export function matchesSearch(plugin: PluginSummary, term: string): boolean {
    const needle = term.trim().toLowerCase();
    if (needle === '') return true;

    const haystack = [
        plugin.name,
        plugin.id,
        plugin.description ?? '',
        roleOf(plugin).title,
        ...plugin.capabilities,
        ...plugin.capabilities.map(capabilityLabel),
    ];
    return haystack.some(text => text.toLowerCase().includes(needle));
}

export function matchesShow(plugin: PluginSummary, show: PluginShow): boolean {
    switch (show) {
        case 'all':
            return true;
        case 'enabled':
            return plugin.enabled;
        case 'disabled':
            return !plugin.enabled;
        case 'attention':
            return needsAttention(plugin);
    }
}
