import { PLUGIN_CAPABILITY_WEATHER, type PluginManifest } from '@deadair/plugin-sdk';
import { z } from 'zod';

export const PLUGIN_ID = 'deadair.weather';
export const PLUGIN_VERSION = '0.0.1';

/**
 * Which service answers.
 *
 * Three arms, and the discriminator exists for `plugins/websearch`'s reason: a
 * second service should be a branch and an option rather than a second plugin,
 * because what an operator is choosing is not a feature but a supplier.
 *
 * Unlike the search plugin, **there is a keyless default and it works out of the
 * box**, which is the whole reason this one is worth shipping enabled-able on a
 * fresh install. Open-Meteo needs no account, covers the world, and is the only
 * one of the three that ships a geocoder — so the other two borrow it, and the
 * plugin's egress list names it whichever engine is chosen.
 */
export const ENGINES = {
    openmeteo: 'Open-Meteo (no account needed)',
    nws: 'US National Weather Service (United States only)',
    openweathermap: 'OpenWeatherMap',
} as const;

export type EngineId = keyof typeof ENGINES;

const ENGINE_IDS = Object.keys(ENGINES) as [EngineId, ...EngineId[]];

/** Which engines need a key, as opposed to being free to ask. */
export const KEYED_ENGINES: readonly EngineId[] = ['openweathermap'];

export const OPEN_METEO_HOST = 'api.open-meteo.com';
export const OPEN_METEO_GEOCODING_HOST = 'geocoding-api.open-meteo.com';
export const NWS_HOST = 'api.weather.gov';
export const OPENWEATHERMAP_HOST = 'api.openweathermap.org';

/**
 * Per-request budget.
 *
 * The same eight seconds `plugins/websearch` uses and for the same reason: a
 * model holds the station's single generation slot from its first tool call to
 * its last, so a service having a slow minute costs a whole break. It is a
 * ceiling rather than a reservation — the host caps every fetch by whatever is
 * left of the current invocation anyway.
 *
 * Worth knowing when reading the providers: one engine answers in one request
 * and one answers in four. The budget check happens once before the first, and
 * the host's own deadline is what stops the fourth.
 */
export const REQUEST_TIMEOUT_MS = 8_000;

/**
 * How long a reading is reused.
 *
 * Ten minutes by default, which is shorter than any of these services updates.
 * The number that matters is not accuracy — an observation is an hour old the
 * moment it is published — but how many times one break asks: a model that calls
 * the tool, then calls it again with a different horizon, is two requests for
 * one sentence without this.
 */
export const DEFAULT_CACHE_MINUTES = 10;

/** Beyond this a reading is stale enough that an operator would rather it were fetched. */
export const MAX_CACHE_MINUTES = 180;

/**
 * How many days of forecast any engine will be asked for.
 *
 * Seven, because a station talks about "the rest of the week" and nothing on air
 * has ever needed more. Every provider clamps to this and then to whatever its
 * own service gives, so a caller asking for thirty gets what exists rather than
 * an error.
 */
export const MAX_FORECAST_DAYS = 7;

/**
 * Requests a second, per service, each in its own bucket.
 *
 * Separate buckets rather than one shared `weather`, because these are three
 * different services' published limits rather than one outbound rate of ours:
 * OpenWeatherMap's free tier is a minute-based allowance that works out at one a
 * second, and the two keyless services are asking only that nobody hammers them.
 * Entries in different buckets never pace each other, which matters here because
 * the National Weather Service arm makes three requests to `api.weather.gov`
 * after one to the geocoder, and a shared bucket would put a second of parking
 * between each of them.
 */
export const RATES = {
    openMeteo: { ratePerSecond: 5, bucket: 'open-meteo' },
    nws: { ratePerSecond: 5, bucket: 'nws' },
    openWeatherMap: { ratePerSecond: 1, bucket: 'openweathermap' },
} as const;

export const configSchema = z
    .object({
        engine: z.enum(ENGINE_IDS).default('openmeteo'),
        apiKey: z.string().optional(),
        contact: z.string().optional(),
        cacheMinutes: z.coerce.number().int().min(1).max(MAX_CACHE_MINUTES).default(DEFAULT_CACHE_MINUTES),
    })
    // Refused at SAVE time rather than read leniently later, for `plugins/rss`'s
    // reason: this is the one moment there is somebody looking at the form to
    // tell. A keyed engine saved without its key is a station that reports the
    // weather as unavailable and gives no hint why.
    .refine(config => !KEYED_ENGINES.includes(config.engine) || hasText(config.apiKey), {
        path: ['apiKey'],
        message: 'This service needs an API key',
    });

export type WeatherConfig = z.infer<typeof configSchema>;

const hasText = (value: string | undefined): boolean => typeof value === 'string' && value.trim().length > 0;

export const weatherManifest: PluginManifest = {
    id: PLUGIN_ID,
    name: 'Weather',
    version: PLUGIN_VERSION,
    capabilities: [PLUGIN_CAPABILITY_WEATHER],
    apiVersion: '^1.0.0',
    description: 'Says what it is like outside, for the places the station talks about.',
    permissions: {
        // Every host is named outright rather than read from a setting: an
        // operator picks a supplier here, not an address, and these three are not
        // an operator's business. The geocoder is separate from the forecast
        // service on Open-Meteo's side, so it is a separate entry sharing that
        // service's bucket — and it is listed whichever engine is chosen, because
        // the National Weather Service arm borrows it to turn a place into
        // coordinates.
        network: [
            { host: OPEN_METEO_HOST, ...RATES.openMeteo },
            { host: OPEN_METEO_GEOCODING_HOST, ...RATES.openMeteo },
            { host: NWS_HOST, ...RATES.nws },
            { host: OPENWEATHERMAP_HOST, ...RATES.openWeatherMap },
        ],
        // Nothing to keep. A reading is worth minutes, so it is cached in memory
        // for as long as the plugin is loaded and thrown away when an operator
        // saves the form — which is the right lifetime for something whose whole
        // value is being current.
        storage: false,
        oauth: false,
    },
    configFields: [
        {
            key: 'engine',
            label: 'Service',
            type: 'select',
            required: true,
            default: 'openmeteo',
            options: Object.entries(ENGINES).map(([value, label]) => ({ value, label })),
            help:
                'Open-Meteo needs no account and covers the world, so it is the one to start with. The National Weather Service is free and ' +
                'has the best forecast there is for a station in the United States, and nothing outside it. OpenWeatherMap needs a key.',
        },
        {
            key: 'apiKey',
            label: 'API key',
            type: 'secret',
            help: 'Only OpenWeatherMap needs one. The other two services are free to ask.',
        },
        {
            key: 'contact',
            label: 'Contact address',
            type: 'string',
            placeholder: 'you@example.com',
            help:
                'Sent with every request so the service can reach whoever is running this station. The National Weather Service asks for one ' +
                'and may refuse without it; the others simply appreciate it.',
        },
        {
            key: 'terms',
            label: 'Whose data this is',
            type: 'note',
            // A note rather than a line in `docs/licensing.md`, because that file is about the right
            // to broadcast RECORDS and is written for a different question. What an operator needs
            // here is which service they have just pointed their station at and where its terms are,
            // at the moment they choose it.
            help:
                'Each of these services sets its own terms, and at least one asks to be credited. Open-Meteo publishes them at ' +
                'open-meteo.com/en/license, the National Weather Service at weather.gov/documentation/services-web-api, and OpenWeatherMap ' +
                'with your account. Worth reading the one you pick, particularly if this station is anything other than a private hobby.',
        },
        {
            key: 'cacheMinutes',
            label: 'Reuse a reading for',
            type: 'number',
            min: 1,
            max: MAX_CACHE_MINUTES,
            default: DEFAULT_CACHE_MINUTES,
            help: 'Minutes. None of these services updates faster than this, and it is what stops one break asking twice.',
        },
    ],
    configSchema,
};
