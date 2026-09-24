import type { PluginSummary } from '@deadair/sdk';

import { capabilityLabel, needsAttention, roleOf } from './plugin.roles';

/**
 * Which plugins the list is narrowed to. `attention` is failed or misconfigured, whether or not it
 * is switched on: a misconfigured plugin is often off BECAUSE it is misconfigured.
 */
export const PLUGIN_SHOWS = ['all', 'enabled', 'attention', 'disabled'] as const;

export type PluginShow = (typeof PLUGIN_SHOWS)[number];

/**
 * How the list is drawn. Cards carry the description and where a plugin stands against the others
 * doing its job; the table gives that up to fit the whole station on one screen.
 */
export const PLUGIN_VIEWS = ['cards', 'table'] as const;

export type PluginView = (typeof PLUGIN_VIEWS)[number];

/**
 * Where the plugin list keeps its search term and status filter: the URL, as the catalog lists do,
 * so "the plugins that need attention" is a link somebody can send and the back button undoes a
 * filter rather than leaving the page.
 */
export interface PluginsPageParams {
    /** Empty means unfiltered. Never undefined, so the page has one shape to handle. */
    q: string;
    /** Not set means the operator has not chosen, and the page decides from the plugins: see {@link defaultShow}. */
    show?: PluginShow;
    view: PluginView;
}

/**
 * What the route strips back out of the URL, so the list at rest has no query string at all.
 *
 * `show` is absent rather than defaulted, which is what keeps a chosen filter in the URL: every one
 * of the four is a real choice once somebody clicks it, "All" included, and only "not chosen yet"
 * is left for the page to decide.
 */
export const PLUGINS_PAGE_DEFAULTS: PluginsPageParams = { q: '', view: 'cards' };

/** Anything unrecognised falls back rather than throwing: a hand-typed link should land on the list. */
export function validatePluginsPage(input: Record<string, unknown>): PluginsPageParams {
    return {
        q: typeof input.q === 'string' ? input.q : '',
        show: PLUGIN_SHOWS.find(known => known === input.show),
        view: PLUGIN_VIEWS.find(known => known === input.view) ?? 'cards',
    };
}

/**
 * The filter a page opens on when nobody has chosen one.
 *
 * What needs attention first, when anything does: the page is where an operator goes to fix a
 * plugin, and a list that opened on everything left them to find the broken one. Otherwise what is
 * switched on, because that is the station as it runs and the rest is a shelf.
 *
 * Unless nothing is switched on, which is every fresh install: opening on "Enabled" there would open
 * on an empty page that says nothing matches, before the operator has done anything at all.
 */
export function defaultShow(plugins: readonly PluginSummary[]): PluginShow {
    if (plugins.some(needsAttention)) return 'attention';
    if (plugins.some(plugin => plugin.enabled)) return 'enabled';
    return 'all';
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
