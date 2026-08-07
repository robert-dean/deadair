import { type PluginManifest } from '@deadair/plugin-sdk';
import { z } from 'zod';

export const PLUGIN_ID = 'deadair.navidrome';
export const PLUGIN_VERSION = '0.0.1';

/**
 * The Subsonic API version this plugin speaks.
 *
 * 1.16.1 is the last version the original Subsonic published and what every
 * server in the family implements, so it is the highest number that is safe to
 * claim. Sent on every request because the protocol requires it.
 */
export const SUBSONIC_API_VERSION = '1.16.1';

/** The `c` parameter: who is calling. Every Subsonic request carries one. */
export const SUBSONIC_CLIENT_NAME = 'deadair';

/**
 * Requests per second. Generous, because this is the operator's own server on
 * their own network rather than a public service with a published policy: the
 * number is here to stop a runaway loop from hammering it, not to ration a
 * budget somebody else set.
 */
export const RATE_PER_SECOND = 10;

/** How long one Subsonic call may take. A library on a LAN, not a service across the internet. */
export const REQUEST_TIMEOUT_MS = 10_000;

/**
 * The most items this plugin will ask for in one call.
 *
 * Subsonic's own ceiling for `search3` counts is 500. The host asks in pages of
 * fifty, so this is a guard against a caller asking for the whole library at
 * once rather than a number anything normally reaches.
 */
export const MAX_PAGE_SIZE = 500;

/**
 * The id of the virtual playlist that is the whole library.
 *
 * A Subsonic server's only enumeration path through the SDK's catalog interface
 * is playlists, and plenty of libraries have none — someone who rips their own
 * CDs and lets deadair do the picking has a full library and an empty playlist
 * list, and would sync nothing at all. So the plugin offers one playlist the
 * server did not: every song, paged.
 *
 * Prefixed so it cannot collide with a real playlist id. Navidrome's are UUIDs,
 * which never contain a colon.
 */
export const EVERYTHING_PLAYLIST_ID = 'navidrome:all';

/** What that virtual playlist calls itself in the console. */
export const EVERYTHING_PLAYLIST_NAME = 'Everything';

/**
 * Candidates an enrichment lookup asks for before scoring them.
 *
 * Subsonic search is a substring match in no useful order, so the answer is
 * often not first: a library holding an album track, a live version and a
 * greatest-hits copy returns all three. Deep enough to get past that run,
 * shallow enough to stay one small response.
 */
export const ENRICHMENT_CANDIDATES = 10;

/**
 * Formats the operator can ask Liquidsoap to be handed.
 *
 * `raw` is the default and means Navidrome sends the file as it is stored, which
 * is what a station wants: no re-encode, no generation loss, no CPU spent on the
 * library machine. The other two exist for a library holding something the
 * decoder on the other end cannot read.
 */
export const STREAM_FORMATS = ['raw', 'mp3', 'opus'] as const;

export const configSchema = z.object({
    baseUrl: z.url(),
    username: z.string().min(1),
    streamFormat: z.enum(STREAM_FORMATS).default('raw'),
    // Subsonic's own parameter is in kbps and means "no limit" when zero, which is
    // the same thing as leaving this blank, so blank is the only way it is said.
    maxBitRate: z.number().int().positive().optional(),
});

export type NavidromeConfig = z.infer<typeof configSchema>;

export const navidromeManifest: PluginManifest = {
    id: PLUGIN_ID,
    name: 'Navidrome',
    version: PLUGIN_VERSION,
    kind: 'music-provider',
    // Grows with the methods that make each one true, never ahead of them: the
    // host requires a capability to be declared AND implemented, and a manifest
    // that promises one it cannot do is its author's bug rather than anything an
    // operator can fix.
    capabilities: ['catalog', 'stream', 'enrichment'],
    apiVersion: '^1.0.0',
    description: "Search and browse a Navidrome library, air its tracks, and read the facts in its files' tags.",
    homepage: 'https://www.navidrome.org',
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
            placeholder: 'http://navidrome.local:4533',
            help: 'The root of your Navidrome server, without /rest.',
        },
        {
            key: 'username',
            label: 'Username',
            type: 'string',
            required: true,
            help: 'A Navidrome account deadair reads the library as. A dedicated one is worth making.',
        },
        {
            key: 'password',
            label: 'Password',
            type: 'secret',
            required: true,
            help: "That account's password. It is never sent as-is: each request carries a salted hash of it.",
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
            help: 'Leave on the original unless your library holds formats the player cannot decode. Transcoding costs the Navidrome machine CPU for every track.',
        },
        {
            key: 'maxBitRate',
            label: 'Maximum bitrate (kbps)',
            type: 'number',
            // No `dependsOn`: it can only ask whether another field is truthy, and
            // `streamFormat` always is. A row that hid itself whenever the format
            // was set would be exactly backwards.
            help: 'Only applies when the format above is not the original file. Blank means no limit.',
        },
    ],
    configSchema,
};
