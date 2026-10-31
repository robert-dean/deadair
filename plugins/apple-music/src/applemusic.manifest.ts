import { type PluginManifest } from '@deadair/plugin-sdk';
import { z } from 'zod';

/**
 * The two hosts this plugin reaches, and which one it uses depends on what the operator has.
 *
 * `api.music.apple.com` is the documented Apple Music API and needs a developer token: a JWT the
 * plugin signs with a MusicKit private key, which requires a paid Apple Developer Program membership.
 * It is the better source — it is the only one that answers with an ISRC, and an ISRC is what makes a
 * row join to the same recording from Navidrome or Spotify instead of sitting beside it.
 *
 * `itunes.apple.com` is the public Search API: no key, no membership, no account. It answers with the
 * same catalog ids the player plays, which is the only reason it is here rather than in a footnote —
 * without it, running Apple Music on this station would cost $99/year before a single record aired.
 * What it costs is the ISRC, the editorial prose and playlists entirely.
 *
 * So the plugin has two modes and the operator chooses by whether they fill the key in. Both are
 * honest; one is thinner, and `testConnection` says which one is in use rather than leaving the
 * operator to infer it from a catalog that looks oddly plain.
 */
export const APPLE_API_HOST = 'api.music.apple.com';
export const ITUNES_HOST = 'itunes.apple.com';

export const APPLE_API_ORIGIN = `https://${APPLE_API_HOST}/v1`;
export const ITUNES_ORIGIN = `https://${ITUNES_HOST}`;

/** Bounds one upstream request. The whole call is bounded separately by the host's own deadline. */
export const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Apple's own ceiling on a developer token's life, and what this plugin signs for.
 *
 * Six months is the documented maximum (`exp` must not be more than 15777000 seconds ahead) and there
 * is nothing to gain from asking for less: the token is minted in-process, cached, and re-minted when
 * it ages out, so a short life only means minting it more often.
 */
export const TOKEN_LIFETIME_S = 15_552_000;

/** Re-mint this far before expiry, so a request never races the clock. */
export const TOKEN_SKEW_MS = 60 * 60_000;

/**
 * The page size asked of either upstream.
 *
 * Apple's catalog search caps a page at 25 and the Search API at 200. The SDK's rule is that `limit`
 * is a TOTAL rather than a page size, so both are paged internally until the caller's number is met.
 */
export const APPLE_PAGE_SIZE = 25;
export const ITUNES_PAGE_SIZE = 200;

/**
 * Artwork comes back as a template with the size written into it, so pin one size.
 *
 * `{w}x{h}bb.jpg` in the Apple API, and `100x100bb.jpg` already substituted in the Search API. Rule 7
 * of the SDK contract: a URL handed back to be stored has to be stable, because the art cache is keyed
 * by the string itself — a varying size means the same cover is downloaded forever.
 */
export const ARTWORK_SIZE = 600;

export const configSchema = z.object({
    /**
     * Which regional catalog to read. Availability, charts and editorial content all differ by
     * storefront, and with no developer token there is no `me/storefront` to ask.
     */
    storefront: z.string().min(2).default('us'),
    teamId: z.string().optional(),
    keyId: z.string().optional(),
    privateKey: z.string().optional(),
});

export type AppleMusicConfig = z.infer<typeof configSchema>;

export const appleMusicManifest: PluginManifest = {
    id: 'deadair.applemusic',
    name: 'Apple Music',
    version: '0.0.1',
    /**
     * `stream` the long way round, like Spotify's and for a different reason.
     *
     * There is no Apple Music URL to mint at any price: the audio is DRM-protected end to end, and the
     * only open asset is a preview. What this plugin returns is a URL on `stream/apple-player`, a
     * container running Apple's own web player and recording what it plays, which it gets by asking the
     * host through `host.trackFetcher.servePlayer` — the `trackFetcher` permission below is what
     * discloses that. Nothing here decrypts anything, and nothing here holds the station's secret.
     *
     * Not `oauth`: the Apple Music API has no authorization-code flow, so `MusicProviderOAuth` is the
     * wrong shape and declaring it would be a lie in the manifest. Not `enrichment`, `charts` or
     * `similarity` yet — all three are cheap once a developer token is in play, and none of them is on
     * the path to a record airing.
     */
    capabilities: ['catalog', 'stream'],
    apiVersion: '^1.0.0',
    description: 'Search Apple Music and pull records into the rotation. Plays through a player container beside the audio chain.',
    homepage: 'https://developer.apple.com/documentation/applemusicapi',
    permissions: {
        network: [APPLE_API_HOST, ITUNES_HOST],
        // No storage: nothing here is remembered between calls that is not either config or the token
        // cache, and the token cache is in memory because re-minting it costs one signature.
        storage: false,
        // No oauth: the Apple Music API has no authorization-code flow to hold tokens from.
        oauth: false,
        // The disclosure that this plugin's audio comes from a helper the station runs rather than from
        // a URL it mints. It is also what puts the playback authorization card on the plugin's page.
        trackFetcher: true,
    },
    configFields: [
        {
            key: 'storefront',
            label: 'Storefront',
            type: 'string',
            required: true,
            help: 'The regional catalog to read, as a two-letter code: us, gb, de. Getting it wrong is a catalog that quietly lacks records you can see in the app.',
        },
        {
            key: 'teamId',
            label: 'Team ID',
            type: 'string',
            help: 'From Membership in your Apple Developer account. Leave the three key fields blank to run without a developer token, on the public Search API — searchable, but with no ISRC and no playlists.',
        },
        {
            key: 'keyId',
            label: 'Key ID',
            type: 'string',
            help: 'The 10-character id of the MusicKit key below.',
        },
        {
            key: 'privateKey',
            label: 'MusicKit private key',
            type: 'secret',
            // A PEM block, and it does not parse without its line breaks.
            multiline: true,
            help: 'The contents of the .p8 file, including the BEGIN and END lines. Creating one needs a paid Apple Developer Program membership.',
        },
    ],
    configSchema,
};

/** Whether the operator has given us everything a developer token needs. */
export function hasDeveloperKey(config: Partial<AppleMusicConfig> | undefined): boolean {
    return (
        typeof config?.teamId === 'string' &&
        config.teamId.trim() !== '' &&
        typeof config.keyId === 'string' &&
        config.keyId.trim() !== '' &&
        typeof config.privateKey === 'string' &&
        config.privateKey.includes('BEGIN')
    );
}
