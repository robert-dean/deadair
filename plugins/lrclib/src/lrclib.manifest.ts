import { type PluginManifest } from '@deadair/plugin-sdk';
import { z } from 'zod';

export const PLUGIN_ID = 'deadair.lrclib';

/** What the operator sees on the card and what the outgoing user-agent names. Hand-kept, apart from the station's version. */
export const PLUGIN_VERSION = '0.1.0';

/**
 * The public service, and the default `baseUrl`.
 *
 * LRCLIB's server is MIT-licensed and publishes database dumps, so an operator who would rather
 * have no third party in the path runs their own copy and points `baseUrl` at it. That is the
 * strongest reason this is the first lyrics source: it is the only one that can be taken off the
 * network entirely.
 */
export const DEFAULT_BASE_URL = 'https://lrclib.net';

/**
 * Requests per second against the public service. LRCLIB publishes no figure, answers an overloaded
 * moment with a 503 and `Retry-After`, and is run as a free public service, so this stays low: the
 * walk is in the background and nothing is waiting on it.
 */
export const PUBLIC_RATE_PER_SECOND = 2;

/** One limiter for the service, whatever hostname it answers on. */
export const LRCLIB_BUCKET = 'lrclib';

/** Per-request budget. The lookup can reach out to other sources on a cold record, so it is not instant. */
export const REQUEST_TIMEOUT_MS = 10_000;

/**
 * How far LRCLIB's own answer may sit from the record's length before it is not believed.
 *
 * Its server already matches within two seconds when it is sent a duration; this is the client
 * holding it to that, plus rounding, because a lyric matched to the wrong recording yields a
 * confident wrong vocal onset and nothing errors.
 */
export const DURATION_TOLERANCE_MS = 3_000;

/** A record every copy of LRCLIB holds, used by `testConnection`. */
export const TEST_RECORD = { artist: 'Portishead', title: 'Glory Box', album: 'Dummy', durationSeconds: 302 } as const;

export const configSchema = z.object({
    baseUrl: z.url().default(DEFAULT_BASE_URL),
});

export type LrclibConfig = z.infer<typeof configSchema>;

export const lrclibManifest: PluginManifest = {
    id: PLUGIN_ID,
    name: 'LRCLIB',
    version: PLUGIN_VERSION,
    capabilities: ['lyrics'],
    apiVersion: '^1.0.0',
    description:
        'The words of each record and the timing of each line, from LRCLIB, an open lyrics database. The station never says or shows them: it uses the timings to know when the singing starts.',
    homepage: 'https://lrclib.net',
    permissions: {
        // The public host first, so a `baseUrl` left pointing at it keeps the gentle rate. A copy the
        // operator runs themselves resolves to its own host at the host's default rate.
        network: [{ host: 'lrclib.net', ratePerSecond: PUBLIC_RATE_PER_SECOND, bucket: LRCLIB_BUCKET }, { fromConfig: 'baseUrl' }],
        storage: false,
        oauth: false,
    },
    configFields: [
        {
            key: 'baseUrl',
            label: 'LRCLIB address',
            type: 'url',
            default: DEFAULT_BASE_URL,
            help: 'The public LRCLIB, or a copy you run yourself from its published database. Its lyrics are contributed by volunteers and their rights are not cleared by anybody, so whether to keep them is your call. The station never says or shows them.',
        },
    ],
    configSchema,
};
