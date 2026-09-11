import { PLUGIN_CAPABILITY_CHARTS, type PluginManifest } from '@deadair/plugin-sdk';
import { z } from 'zod';

/** Apple's public feed generator. It needs no account and no key. */
export const FEED_HOST = 'rss.marketingtools.apple.com';

/** The storefronts offered in the settings form. Apple publishes many more; add the ones you want. */
export const COUNTRIES = {
    us: 'United States',
    gb: 'United Kingdom',
    ca: 'Canada',
    au: 'Australia',
    de: 'Germany',
    fr: 'France',
    jp: 'Japan',
} as const;

export type Country = keyof typeof COUNTRIES;

const COUNTRY_CODES = Object.keys(COUNTRIES) as [Country, ...Country[]];

/** What `host.config.get()` answers once the station has validated it against this schema. */
export const appleChartsConfig = z.object({
    country: z.enum(COUNTRY_CODES).default('us'),
});

export const appleChartsManifest: PluginManifest = {
    // Reverse-DNS and yours. `deadair.` is the namespace of the plugins that ship with the station.
    id: 'example.apple-music-charts',
    name: 'Apple Music charts',
    version: '0.1.0',
    description: "Apple Music's most-played songs in one country, as a chart the station can programme an hour from.",
    capabilities: [PLUGIN_CAPABILITY_CHARTS],
    // The plugin API this was written against. The station refuses to load a plugin whose range does
    // not cover its own version, which is the one compatibility check that is enforced.
    apiVersion: '^1.0.0',
    permissions: {
        // Every host this plugin reaches. `host.fetch` refuses anything not named here, and Apple does
        // not publish a rate limit for the feed, so none is declared.
        network: [FEED_HOST],
        storage: false,
        oauth: false,
    },
    configFields: [
        {
            key: 'country',
            label: 'Country',
            type: 'select',
            default: 'us',
            options: Object.entries(COUNTRIES).map(([value, label]) => ({ value, label })),
            help: 'Whose most-played songs to follow. Each storefront has its own chart.',
        },
    ],
    configSchema: appleChartsConfig,
};
