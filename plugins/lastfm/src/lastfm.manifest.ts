import { type PluginManifest } from '@deadair/plugin-sdk';
import { z } from 'zod';

export const PLUGIN_ID = 'deadair.lastfm';
export const PLUGIN_VERSION = '0.0.1';

/** The API root. Every capability here talks to this one address. */
export const API_ROOT = 'https://ws.audioscrobbler.com/2.0/';

/** The API's hostname, for the manifest's network allowlist. */
export const API_HOST = 'ws.audioscrobbler.com';

/**
 * Where a person is sent to approve the station, and the one URL here that this
 * plugin never fetches: it is handed to the operator's browser by the console.
 *
 * That is why `www.last.fm` is absent from `permissions.network`, exactly as the
 * Cover Art Archive is absent from the MusicBrainz plugin's, and it has to stay
 * absent unless something here actually starts fetching it.
 */
export const AUTH_ORIGIN = 'https://www.last.fm/api/auth/';

/**
 * One bucket for the service.
 *
 * The published terms ask for a rate that is "not excessive" without naming a
 * number; the figure every client settles on is around five a second, and that
 * is what this declares. It is a ceiling rather than a target — the enrichment
 * walk is the only caller that makes many requests in a row, and it is paced by
 * the host rather than by anything here.
 */
export const RATE_PER_SECOND = 5;

export const BUCKET = 'lastfm';

/**
 * Per-request budget.
 *
 * Shorter than the MusicBrainz plugin's ten seconds, because this service is
 * fast when it is up and unresponsive when it is not — there is no slow-under-
 * load middle ground to wait through. A scrobble batch that times out is
 * deferred by the host and tried again, so patience buys nothing.
 */
export const REQUEST_TIMEOUT_MS = 8_000;

/**
 * Tag weight below which a tag is not really about the record.
 *
 * Last.fm scores the tags on an entity from 0 to 100 relative to its most
 * applied one, so this is a share of the top tag rather than a vote count. Ten
 * keeps the shape of a record's tagging while dropping the long tail, which on
 * anything popular is thousands of tags applied once each.
 */
export const DEFAULT_MIN_TAG_WEIGHT = 10;

/** Plays per scrobble request. The service's own documented batch ceiling. */
export const SCROBBLE_BATCH_SIZE = 50;

/** A stable, well-tagged artist, used by `testConnection` because it will not 404. */
export const TEST_ARTIST = 'Portishead';

export const configSchema = z.object({
    scrobbling: z.boolean().default(false),
    chartCountry: z.string().max(100).default(''),
    includeTags: z.boolean().default(true),
    minTagWeight: z.coerce.number().int().min(0).max(100).default(DEFAULT_MIN_TAG_WEIGHT),
});

export type LastfmConfig = z.infer<typeof configSchema>;

export const lastfmManifest: PluginManifest = {
    id: PLUGIN_ID,
    name: 'Last.fm',
    version: PLUGIN_VERSION,
    // Four, which is unusual and is the point: one service answers four different
    // questions the station asks, and splitting it into four plugins would mean
    // four API keys and four copies of the same signing code.
    capabilities: ['enrichment', 'charts', 'similarity', 'scrobble', 'oauth'],
    apiVersion: '^1.0.0',
    description: 'Tags, artist background and listener counts; the charts; who sounds like whom; and scrobbling what the station plays.',
    homepage: 'https://www.last.fm/api',
    permissions: {
        network: [{ host: API_HOST, ratePerSecond: RATE_PER_SECOND, bucket: BUCKET }],
        // No storage. Everything this plugin learns about a record is stored by
        // the host against that record, and the session key lives in the OAuth
        // vault, so there is nothing for a plugin-private store to hold.
        storage: false,
        oauth: true,
    },
    configFields: [
        {
            key: 'apiKey',
            label: 'API key',
            // A `secret`, so the host encrypts it and the settings card never reads
            // it back. Read through `host.secrets.get`, which is why it is absent
            // from `configSchema`.
            type: 'secret',
            required: true,
            help: 'Free, from last.fm/api/account/create. Everything below needs one. Their terms are non-commercial: fine for one person running one station, not for a service you charge for.',
        },
        {
            key: 'apiSecret',
            label: 'API secret',
            type: 'secret',
            help: 'The shared secret issued alongside your API key. Only needed for scrobbling, which signs every request with it. Leave it blank if you only want the tags and the charts.',
        },
        {
            key: 'scrobbling',
            label: 'Scrobble what the station plays',
            type: 'boolean',
            default: false,
            help: 'Off by default, because reading a service and publishing your listening to it are different decisions. With it on, every record the station airs is submitted to the account you connect below, once it has played for half its length.',
        },
        {
            key: 'chartCountry',
            label: 'Chart country',
            type: 'string',
            placeholder: 'United Kingdom',
            help: 'Adds your own country to the charts on offer, spelled as Last.fm spells it (a full name, not a code). The global chart and a handful of common countries are always offered.',
        },
        {
            key: 'includeTags',
            label: 'Use community tags',
            type: 'boolean',
            default: true,
            help: "What listeners have tagged a record with. The useful ones become genres and moods; the ones about somebody's own collection are dropped.",
        },
        {
            key: 'minTagWeight',
            label: 'Minimum tag weight',
            type: 'number',
            default: DEFAULT_MIN_TAG_WEIGHT,
            dependsOn: 'includeTags',
            help: 'How strongly a tag has to apply, out of 100, before it counts. Lower it for more genres per record, raise it if the station starts describing records oddly.',
        },
    ],
    configSchema,
};
