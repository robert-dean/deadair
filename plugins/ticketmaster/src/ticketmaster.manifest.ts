import { PLUGIN_CAPABILITY_CONCERTS, type PluginManifest } from '@deadair/plugin-sdk';
import { z } from 'zod';

export const PLUGIN_ID = 'deadair.ticketmaster';
export const PLUGIN_VERSION = '0.0.1';

export const TICKETMASTER_HOST = 'app.ticketmaster.com';
/** Ticketmaster takes coordinates or a market id and has no geocoder, so a place is resolved here. */
export const OPEN_METEO_GEOCODING_HOST = 'geocoding-api.open-meteo.com';

/** Per-request budget, `plugins/weather`'s and for its reason: a break is waiting on this. */
export const REQUEST_TIMEOUT_MS = 8_000;

/** Budget below which a read is not worth starting. See `plugins/weather`'s `READ_BUDGET_MS`. */
export const READ_BUDGET_MS = 1_500;

/**
 * How long an answer is reused.
 *
 * Six hours, because a station plays the same artists all day and the free key
 * is 5,000 calls a day. A show called off this afternoon can therefore be said
 * until the window ends, which is why it is a setting with a short minimum.
 */
export const DEFAULT_CACHE_HOURS = 6;
export const MAX_CACHE_HOURS = 24;

/** How far from the station a show still counts by default: a metro area, not a day's drive. */
export const DEFAULT_RADIUS_KM = 60;

/** The longest radius a caller may ask for. A station's town is not half a state. */
export const MAX_RADIUS_KM = 200;

/** Shows asked for per lookup. A keyword search is padded with other acts, and the exact match happens afterwards. */
export const PAGE_SIZE = 50;

/** How long the service is left alone after failing. See `plugins/weather`'s `FAILURE_HOLD_MS`. */
export const FAILURE_HOLD_MS = 60_000;

/** The longest a `Retry-After` is honoured for. */
export const MAX_FAILURE_HOLD_MS = 15 * 60_000;

export const configSchema = z.object({
    apiKey: z.string().min(1, 'Ticketmaster needs an API key'),
    cacheHours: z.coerce.number().int().min(1).max(MAX_CACHE_HOURS).default(DEFAULT_CACHE_HOURS),
    radiusKm: z.coerce.number().int().min(1).max(MAX_RADIUS_KM).default(DEFAULT_RADIUS_KM),
});

export type TicketmasterConfig = z.infer<typeof configSchema>;

export const ticketmasterManifest: PluginManifest = {
    id: PLUGIN_ID,
    name: 'Ticketmaster',
    version: PLUGIN_VERSION,
    capabilities: [PLUGIN_CAPABILITY_CONCERTS],
    apiVersion: '^1.0.0',
    description:
        "Says when the artists on a show are next playing near the station, from Ticketmaster's listings, and looks festivals up by name for the Festivals tab.",
    permissions: {
        // Five a second is the key's published default.
        network: [
            { host: TICKETMASTER_HOST, ratePerSecond: 5, bucket: 'ticketmaster' },
            { host: OPEN_METEO_GEOCODING_HOST, ratePerSecond: 5, bucket: 'open-meteo' },
        ],
        // Nothing to keep. A listing is worth hours and is held in memory, so a
        // config save starts clean.
        storage: false,
        oauth: false,
    },
    configFields: [
        {
            key: 'apiKey',
            label: 'API key',
            type: 'secret',
            required: true,
            help: 'The consumer key of a free app at developer.ticketmaster.com.',
        },
        {
            key: 'cacheHours',
            label: 'Reuse an answer for',
            type: 'number',
            default: DEFAULT_CACHE_HOURS,
            min: 1,
            max: MAX_CACHE_HOURS,
            help: 'Hours. Shorter hears about a cancelled show sooner and spends more of the daily allowance.',
        },
        {
            key: 'radiusKm',
            label: 'How far counts as nearby',
            type: 'number',
            default: DEFAULT_RADIUS_KM,
            min: 1,
            max: MAX_RADIUS_KM,
            help: 'Kilometres from the station, so the suburbs of a metro area count.',
        },
    ],
    configSchema,
};
