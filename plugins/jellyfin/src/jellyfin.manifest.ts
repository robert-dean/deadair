import { type PluginManifest } from '@deadair/plugin-sdk';
import { z } from 'zod';

export const PLUGIN_ID = 'deadair.jellyfin';
export const PLUGIN_VERSION = '0.0.1';

/** What this plugin calls itself in the `Authorization` header, and so in the server's device list. */
export const CLIENT_NAME = 'deadair';

/**
 * The device id every request claims.
 *
 * Fixed rather than random: Jellyfin keys its device list on this, and an id
 * minted per load would add a row to the operator's dashboard every time a
 * setting was saved.
 */
export const DEVICE_ID = 'deadair-station';

/**
 * Requests per second. Generous, because this is the operator's own server on
 * their own network: the number is here to stop a runaway loop from hammering
 * it, not to ration a budget somebody else set.
 */
export const RATE_PER_SECOND = 10;

/** How long one Jellyfin call may take. A library on a LAN, not a service across the internet. */
export const REQUEST_TIMEOUT_MS = 10_000;

/**
 * The most items this plugin will ask for in one call.
 *
 * Jellyfin sets no ceiling of its own, so this is a guard against a caller
 * asking for the whole library at once rather than a number anything normally
 * reaches: the host asks in pages of fifty.
 */
export const MAX_PAGE_SIZE = 500;

/**
 * The id of the virtual playlist that is the whole library.
 *
 * The catalog reaches a provider's tracks through its playlists, and plenty of
 * libraries have none, so the plugin offers one playlist the server did not:
 * every track, paged. Prefixed so it cannot collide with a real playlist id,
 * which Jellyfin writes as 32 hex digits.
 */
export const EVERYTHING_PLAYLIST_ID = 'jellyfin:all';

/** What that virtual playlist calls itself in the console. */
export const EVERYTHING_PLAYLIST_NAME = 'Everything';

/**
 * How many artists a search reads when it looks for one at the front of the query.
 *
 * The probe is a substring match on one word, so a common first word ("DJ",
 * "Lil") brings back a crowd. Deep enough to find the one the query names in
 * it, shallow enough to stay one small response.
 */
export const ARTIST_PROBE_LIMIT = 100;

/** The most artist-scoped searches one query spends, longest artist name first. */
export const ARTIST_SEARCHES = 2;

/**
 * Formats the operator can ask Liquidsoap to be handed.
 *
 * `raw` is the default and means Jellyfin sends the file as it is stored, which
 * is what a station wants: no re-encode, no generation loss, no CPU spent on the
 * library machine. The other two exist for a library holding something the
 * decoder on the other end cannot read.
 */
export const STREAM_FORMATS = ['raw', 'mp3', 'opus'] as const;

export const configSchema = z.object({
    baseUrl: z.url(),
    username: z.string().min(1),
    streamFormat: z.enum(STREAM_FORMATS).default('raw'),
    // Blank means no limit, which is also what Jellyfin does with an absent
    // `audioBitRate`, so blank is the only way it is said.
    maxBitRate: z.number().int().positive().optional(),
});

export type JellyfinConfig = z.infer<typeof configSchema>;

export const jellyfinManifest: PluginManifest = {
    id: PLUGIN_ID,
    name: 'Jellyfin',
    version: PLUGIN_VERSION,
    // Grows with the methods that make each one true, never ahead of them: the
    // host requires a capability to be declared AND implemented.
    capabilities: ['catalog', 'stream'],
    apiVersion: '^1.0.0',
    description: "Search and browse a Jellyfin server's music library and air its tracks.",
    homepage: 'https://jellyfin.org',
    permissions: {
        // The operator names the server, so there is no hostname to write down at
        // authoring time. A blank or unparseable setting contributes no entry,
        // which means an unconfigured plugin is refused exactly as if it had asked
        // for an undeclared host.
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
            placeholder: 'http://jellyfin.local:8096',
            help: 'The root of your Jellyfin server, as you would type it into a browser.',
        },
        {
            key: 'apiKey',
            label: 'API key',
            type: 'secret',
            // Sent to that server, so moving the address means typing this again. See the SDK's `sentTo`.
            sentTo: 'baseUrl',
            required: true,
            help: 'Made in the Jellyfin dashboard under API Keys. It is sent with every request, and it is part of the address the station fetches each record from.',
        },
        {
            key: 'username',
            label: 'Username',
            type: 'string',
            required: true,
            help: 'The Jellyfin user deadair reads the library as. An API key belongs to no user, and Jellyfin will not list playlist contents without one; this user also decides which libraries are visible.',
        },
        {
            key: 'streamFormat',
            label: 'Stream format',
            type: 'select',
            default: 'raw',
            options: [
                { value: 'raw', label: 'Original file (no transcode)' },
                { value: 'mp3', label: 'MP3' },
                { value: 'opus', label: 'Opus' },
            ],
            help: 'Leave on the original unless your library holds formats the player cannot decode. The original is the only way a lossless library reaches the station lossless: anything else is a lossy copy that the stream then encodes again, and it costs the Jellyfin machine CPU for every track.',
        },
        {
            key: 'maxBitRate',
            label: 'Maximum bitrate (kbps)',
            type: 'number',
            help: 'Only applies when the format above is not the original file. Blank means no limit.',
        },
    ],
    configSchema,
};
