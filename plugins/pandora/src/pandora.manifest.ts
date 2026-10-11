import { type PluginManifest } from '@deadair/plugin-sdk';
import { z } from 'zod';

export const PLUGIN_ID = 'deadair.pandora';
export const PLUGIN_VERSION = '0.0.1';

/**
 * Where the sign-in happens. Pandora's tuner API is the one its own Android app speaks, and the only
 * one that signs in with an email and a password without a browser's bot check in front of it.
 */
export const TUNER_HOST = 'tuner.pandora.com';

/** Where everything else happens: the web app's REST API, with the token the tuner sign-in issued. */
export const WEB_HOST = 'www.pandora.com';

/**
 * The tuner API's Android partner profile.
 *
 * Pandora's own, published in the unofficial API documentation and used unchanged by pianobar, pydora
 * and pandora-tui. Not a secret of the operator's: every client of this API sends the same one, which
 * is also why Pandora rotating it breaks all of them at once. When that happens `auth.partnerLogin`
 * answers with a failure and this plugin says so rather than retrying.
 */
export const PARTNER = {
    username: 'android',
    password: 'AC7IBG09A3DTSYM4R41UJWL07VLN8JI7',
    deviceModel: 'android-generic',
    version: '5',
    /** Blowfish key for request bodies. */
    encryptKey: '6#26FRL$ZWD',
    /** Blowfish key for the `syncTime` the partner sign-in answers with. */
    decryptKey: 'R=U!LH$O2B#',
} as const;

/**
 * Requests per second against Pandora, both hosts together.
 *
 * Pandora publishes no limit for an API it does not publish, so this is a client's pace rather than a
 * ration: a listener's app makes a handful of calls a minute, and an account suddenly making a
 * hundred a second is the likeliest way to get it noticed.
 */
export const RATE_PER_SECOND = 2;

/** One bucket for both hosts, because they are one service counting one account. */
export const BUCKET = 'pandora';

/** How long one call may take. */
export const REQUEST_TIMEOUT_MS = 15_000;

/** The most results the search endpoint is asked for in one call. Pages up to the caller's total. */
export const SEARCH_PAGE_SIZE = 50;

/** The most tracks one `getTracks` page asks for. */
export const PLAYLIST_PAGE_SIZE = 100;

/** The most ids sent to `annotateObjects` at once. */
export const ANNOTATE_BATCH = 100;

/**
 * How many served copies are remembered for their playback reports.
 *
 * A report is sent against the `sourceId`, `index` and `trackToken` the copy was served under, and the
 * station fetches a handful of records ahead of air, so this only has to outlast that lead plus a
 * record's length. Bounded, because a long-running station serves thousands.
 */
export const SERVED_MEMORY = 64;

/**
 * How long to wait before asking again when Pandora says the account is streaming elsewhere. A song
 * or so, since that is the soonest somebody listening on their phone is likely to have stopped.
 */
export const BUSY_RETRY_MS = 5 * 60 * 1000;

export const configSchema = z.object({
    email: z.string().min(1),
});

export type PandoraConfig = z.infer<typeof configSchema>;

export const pandoraManifest: PluginManifest = {
    id: PLUGIN_ID,
    name: 'Pandora',
    version: PLUGIN_VERSION,
    // Grows with the methods that make each one true, never ahead of them.
    capabilities: ['catalog'],
    apiVersion: '^1.0.0',
    description: 'Search Pandora and import its playlists. Unofficial: Pandora publishes no API, and this works only from the US.',
    homepage: 'https://www.pandora.com',
    permissions: {
        network: [
            { host: TUNER_HOST, ratePerSecond: RATE_PER_SECOND, bucket: BUCKET },
            { host: WEB_HOST, ratePerSecond: RATE_PER_SECOND, bucket: BUCKET },
        ],
        // The device id Pandora knows this station by, made once and kept so the account sees one
        // device rather than a new one on every restart.
        storage: true,
        oauth: false,
    },
    configFields: [
        {
            key: 'email',
            label: 'Email',
            type: 'string',
            required: true,
            help: 'The email address of the Pandora account the station uses. Pandora plays one stream per account at a time.',
        },
        {
            key: 'password',
            label: 'Password',
            type: 'secret',
            required: true,
            help: "That account's password. Pandora has no way to let an app in without it.",
        },
    ],
    configSchema,
};
