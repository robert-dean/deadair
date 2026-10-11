import { type PluginManifest } from '@deadair/plugin-sdk';
import { z } from 'zod';

export const PLUGIN_ID = 'deadair.plex';
export const PLUGIN_VERSION = '0.0.1';

/** What this plugin calls itself to Plex, in `X-Plex-Product`. */
export const PRODUCT = 'deadair';

/**
 * The `X-Plex-Client-Identifier` every request carries.
 *
 * Fixed rather than random: Plex keys its device list on it, and an id minted
 * per load would add a device to the operator's account every time a setting
 * was saved.
 */
export const CLIENT_IDENTIFIER = 'deadair-station';

/**
 * Requests per second. Generous, because this is the operator's own server: the
 * number is here to stop a runaway loop from hammering it, not to ration a
 * budget somebody else set.
 */
export const RATE_PER_SECOND = 10;

/** How long one Plex call may take. A library on a LAN, not a service across the internet. */
export const REQUEST_TIMEOUT_MS = 10_000;

/**
 * The most items this plugin will ask for in one call.
 *
 * A guard against a caller asking for the whole library at once rather than a
 * number anything normally reaches: the host asks in pages of fifty.
 */
export const MAX_PAGE_SIZE = 500;

/**
 * The prefix of the virtual playlists that are whole music libraries, one per
 * library section, followed by the section's key.
 *
 * The catalog reaches a provider's tracks through its playlists, and plenty of
 * libraries have none. A colon never appears in a Plex rating key, which is a
 * number, so these cannot collide with a real playlist.
 */
export const EVERYTHING_PREFIX = 'plex:section:';

/** How long the list of music libraries is trusted before it is read again. */
export const SECTIONS_TTL_MS = 5 * 60_000;

/**
 * How many artists a search reads when it looks for one at the front of the
 * query: deep enough to find the one meant among everybody sharing a word of
 * their name, shallow enough to stay one small response.
 */
export const ARTIST_PROBE_LIMIT = 100;

/** The most artist-scoped searches one query spends, longest artist name first. */
export const ARTIST_SEARCHES = 2;

export const configSchema = z.object({
    baseUrl: z.url(),
});

export type PlexConfig = z.infer<typeof configSchema>;

export const plexManifest: PluginManifest = {
    id: PLUGIN_ID,
    name: 'Plex',
    version: PLUGIN_VERSION,
    // Grows with the methods that make each one true, never ahead of them: the
    // host requires a capability to be declared AND implemented.
    capabilities: ['catalog', 'stream', 'enrichment'],
    apiVersion: '^1.0.0',
    description: "Search and browse a Plex Media Server's music libraries, air their tracks, and read what Plex knows about them.",
    homepage: 'https://www.plex.tv',
    permissions: {
        // The operator names the server. A blank or unparseable setting
        // contributes no entry, so an unconfigured plugin is refused exactly as if
        // it had asked for an undeclared host.
        network: [{ fromConfig: 'baseUrl', ratePerSecond: RATE_PER_SECOND }],
        storage: false,
        oauth: false,
    },
    configFields: [
        {
            key: 'baseUrl',
            label: 'Server URL',
            type: 'url',
            required: true,
            placeholder: 'http://plex.local:32400',
            help: 'The address of your Plex Media Server itself, port included. Not app.plex.tv: the station talks to the server directly.',
        },
        {
            key: 'token',
            label: 'Plex token',
            type: 'secret',
            required: true,
            help: "Your X-Plex-Token. In Plex Web, open the browser's developer console and run localStorage.myPlexAccessToken, or open an album's Get Info, then View XML, and copy the value after X-Plex-Token= in the address. It is sent with every request, and it is part of the address the station fetches each record from.",
        },
    ],
    configSchema,
};
