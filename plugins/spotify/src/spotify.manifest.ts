import { type PluginManifest } from '@deadair/plugin-sdk';
import { z } from 'zod';

/**
 * Scopes requested at authorize time. Carried over verbatim from the legacy
 * first-party Spotify client so an existing connection asks for exactly what
 * it used to: the catalog half feeds the rotation pool, the playback half
 * backs the settings card's preview and the Connect session.
 */
export const SPOTIFY_SCOPES: string[] = [
    // Catalog / profile — the rotation pool
    'user-read-private',
    'user-read-email',
    'user-library-read',
    'playlist-read-private',
    'playlist-read-collaborative',
    'user-top-read',
    // The shim's session, plus the settings card's playback preview
    'streaming',
    'user-read-playback-state',
    'user-modify-playback-state',
    'user-read-currently-playing',
] as const;

export const ACCOUNTS_ORIGIN = 'https://accounts.spotify.com';
export const API_ORIGIN = 'https://api.spotify.com/v1';

/** Refresh this far before the recorded expiry, so a request never races the clock. */
export const TOKEN_EXPIRY_SKEW_MS = 30_000;

/** Fallback lifetime when Spotify omits `expires_in`. Spotify's real value is 3600. */
export const DEFAULT_TOKEN_LIFETIME_S = 3600;

export const REQUEST_TIMEOUT_MS = 10_000;

export const configSchema = z.object({
    clientId: z.string().min(1),
    redirectUri: z.url(),
    deviceName: z.string().optional(),
});

export type SpotifyConfig = z.infer<typeof configSchema>;

export const spotifyManifest: PluginManifest = {
    id: 'deadair.spotify',
    name: 'Spotify',
    version: '0.0.1',
    kind: 'music-provider',
    capabilities: ['catalog', 'playout', 'oauth'],
    apiVersion: '^1.0.0',
    description: 'Search Spotify, browse your playlists, and pull tracks into the rotation.',
    homepage: 'https://developer.spotify.com/documentation/web-api',
    permissions: {
        network: ['accounts.spotify.com', 'api.spotify.com'],
        storage: true,
        oauth: true,
    },
    configFields: [
        {
            key: 'clientId',
            label: 'Client ID',
            type: 'string',
            required: true,
            help: 'From your app at developer.spotify.com/dashboard.',
        },
        {
            key: 'redirectUri',
            label: 'Redirect URI',
            type: 'url',
            required: true,
            help: 'Must match a redirect URI registered on the Spotify app, character for character.',
        },
        {
            key: 'deviceName',
            label: 'Device name',
            type: 'string',
            help: 'The Spotify Connect device to steer, e.g. the go-librespot device. Blank means whatever device is currently active.',
        },
    ],
    configSchema,
};

// §3 note: a config saved under the old (client-secret) shape leaves that
// secret's ciphertext sitting in the `secrets` blob — PluginConfigService.saveConfig
// only copies existing secrets across and rewrites the fields it's told about, it
// never prunes ones a newer manifest dropped. That leftover is unreachable (the
// read model only reports on fields the current manifest declares) and isn't worth
// a migration.
