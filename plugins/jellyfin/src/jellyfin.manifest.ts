import { configSchema, everythingPlaylistId, RATE_PER_SECOND } from '@deadair/mediabrowser';
import { type PluginManifest } from '@deadair/plugin-sdk';

import { JELLYFIN, PLUGIN_VERSION } from './jellyfin.dialect.js';

export const PLUGIN_ID = 'deadair.jellyfin';

/**
 * The id of the virtual playlist that is the whole library.
 *
 * The catalog reaches a provider's tracks through its playlists, and plenty of libraries have none, so
 * the plugin offers one playlist the server did not: every track, paged. Prefixed so it cannot collide
 * with a real playlist id, which Jellyfin writes as 32 hex digits.
 */
export const EVERYTHING_PLAYLIST_ID = everythingPlaylistId(JELLYFIN);

export const jellyfinManifest: PluginManifest = {
    id: PLUGIN_ID,
    name: 'Jellyfin',
    version: PLUGIN_VERSION,
    // Grows with the methods that make each one true, never ahead of them: the
    // host requires a capability to be declared AND implemented.
    capabilities: ['catalog', 'stream', 'enrichment'],
    apiVersion: '^1.0.0',
    description: "Search and browse a Jellyfin server's music library, air its tracks, and read what it knows about them.",
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
