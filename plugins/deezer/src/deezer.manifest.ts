import { type PluginManifest } from '@deadair/plugin-sdk';
import { z } from 'zod';

export const PLUGIN_ID = 'deadair.deezer';
export const PLUGIN_VERSION = '0.0.1';

export const API_HOST = 'api.deezer.com';
export const API_ROOT = `https://${API_HOST}`;

/**
 * Deezer's public catalogue endpoints take no key and no account, which is the
 * whole reason this plugin exists: the station's outward half was inert on any
 * install whose operator had not registered with Last.fm.
 *
 * Deezer publishes no rate in its documentation and the responses carry no
 * budget headers, so this is a politeness ceiling rather than a documented
 * limit. The figure quoted everywhere is fifty requests in five seconds; five a
 * second is half of that, and well clear of what this asks for anyway — a
 * refill touches a handful of artists and the answers are cached by the host
 * for a day.
 */
export const RATE_PER_SECOND = 5;

export const BUCKET = 'deezer';

/** Per-request budget. Every call here is one small JSON document. */
export const REQUEST_TIMEOUT_MS = 8_000;

/** How many neighbours to ask for when the host does not say. */
export const DEFAULT_SIMILAR_LIMIT = 20;

/** How many records by one artist to ask for when the host does not say. */
export const DEFAULT_TOP_LIMIT = 10;

/**
 * Daft Punk, whose id will not stop existing, so `testConnection` can rely on
 * it. It is a fixed id rather than a search because the health check should
 * fail when Deezer is unreachable and not when its search ranking moves.
 */
export const TEST_ARTIST_ID = 27;

/**
 * Empty, because there is nothing to configure: no key, no account, no address.
 * The manifest requires a schema, so this is the honest one rather than an
 * absence.
 */
export const configSchema = z.object({});

export type DeezerConfig = z.infer<typeof configSchema>;

/**
 * No config fields at all, which is the point of this plugin: an operator
 * enables it and the station can reach outside its own library.
 */
export const deezerManifest: PluginManifest = {
    id: PLUGIN_ID,
    name: 'Deezer',
    version: PLUGIN_VERSION,
    capabilities: ['similarity'],
    apiVersion: '^1.0.0',
    description: 'Who sounds like whom, and what to play by them, from Deezer’s public catalogue. Needs no account and no API key.',
    homepage: 'https://developers.deezer.com/api',
    permissions: {
        network: [{ host: API_HOST, ratePerSecond: RATE_PER_SECOND, bucket: BUCKET }],
        // Nothing to keep. Every answer is names, and the host caches them.
        storage: false,
        oauth: false,
    },
    configFields: [],
    configSchema,
};
