import { type PluginManifest } from '@deadair/plugin-sdk';
import { z } from 'zod';

export const PLUGIN_ID = 'deadair.podcast';
export const PLUGIN_VERSION = '0.0.1';

/**
 * Per-request budget for a feed.
 *
 * Longer than `plugins/rss`'s, and for a measured reason rather than caution: a
 * podcast feed carries every episode the show ever published, each with its full
 * show notes, and a long-running show's feed is several megabytes served by a
 * hosting company's origin rather than a CDN edge. The host caps every fetch by
 * whatever is left of the current invocation anyway, so this is a ceiling and
 * not a reservation.
 */
export const REQUEST_TIMEOUT_MS = 15_000;

/** Per-request budget for a directory search. A search API answers fast or not at all. */
export const DIRECTORY_TIMEOUT_MS = 8_000;

/**
 * One request a second across every feed on the list, in one bucket.
 *
 * `plugins/rss`'s argument exactly: what is paced is this station's own outbound
 * rate, and a list of twenty shows refreshing at once is the behaviour worth
 * flattening.
 */
export const FEED_RATE_PER_SECOND = 1;
export const FEED_BUCKET = 'podcast';

/**
 * Apple's directory, at the rate Apple publishes for it.
 *
 * The iTunes Search API documents roughly twenty calls a minute per caller and
 * answers faster callers with 403s rather than 429s, so going over it looks like
 * a broken plugin rather than a slow one. A third of a request a second is that
 * limit with nothing to spare, which is right for a search an operator types.
 */
export const DIRECTORY_HOST = 'itunes.apple.com';
export const DIRECTORY_RATE_PER_SECOND = 1 / 3;

/**
 * How long a fetched feed is reused, in seconds.
 *
 * Five minutes rather than rss's one, because the two are read for different
 * reasons. A news feed is read by a break that wants what happened in the last
 * few minutes; a podcast feed is read by a refresh that runs every half hour and
 * by an operator browsing shows, and a show publishes weekly. Long enough that a
 * page of shows opened twice does not ask every host twice.
 */
export const DEFAULT_CACHE_SECONDS = 300;

/** Whether an operator may search Apple's directory from the console, when nobody has said. */
export const DEFAULT_DIRECTORY = true;

export const configSchema = z.object({
    /**
     * The rows, as the JSON array a `list` field is stored as.
     *
     * Refused at save rather than read leniently, on `plugins/rss`'s rule: a save is the one moment
     * there is somebody to tell, and a subscription that saved cleanly and never produced an episode
     * is exactly the failure a row with a typed address exists to end. Everything that reads it later
     * is lenient and drops what it cannot use.
     */
    feeds: z
        .string()
        .default('[]')
        .refine(value => value.trim().length === 0 || readsAsFeedRows(value), 'Each show needs a feed address starting with http:// or https://'),
    directory: z.coerce.boolean().default(DEFAULT_DIRECTORY),
    /**
     * Which of Apple's national stores a directory search reads, as its two-letter code.
     *
     * Blank is Apple's own default (the United States). A store matters more than it sounds: a show
     * can be listed in one country's directory and absent from another's.
     */
    country: z
        .string()
        .trim()
        .default('')
        .refine(value => value.length === 0 || /^[a-zA-Z]{2}$/.test(value), 'A country is two letters, like gb or de'),
    cacheSeconds: z.coerce.number().int().min(0).max(86_400).default(DEFAULT_CACHE_SECONDS),
});

export type PodcastConfig = z.infer<typeof configSchema>;

/** Whether every row a saved value holds carries an address something could actually fetch. */
function readsAsFeedRows(value: string): boolean {
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch {
        return false;
    }

    if (!Array.isArray(parsed)) return false;

    return parsed.every(row => {
        if (typeof row !== 'object' || row === null || Array.isArray(row)) return false;
        const url = (row as Record<string, unknown>).url;
        return typeof url === 'string' && isFetchable(url);
    });
}

const isFetchable = (url: string): boolean => {
    try {
        const { protocol } = new URL(url.trim());
        return protocol === 'http:' || protocol === 'https:';
    } catch {
        return false;
    }
};

export const podcastManifest: PluginManifest = {
    id: PLUGIN_ID,
    name: 'Podcasts',
    version: PLUGIN_VERSION,
    capabilities: ['podcast'],
    apiVersion: '^1.0.0',
    description:
        "Reads the podcast feeds you subscribe the station to, so it can carry somebody else's programme at a time you choose, with your presenter around it.",
    permissions: {
        // The feeds are whatever the operator subscribed to, so there is no hostname to write down
        // at authoring time: the host reads one per ROW out of the column declared `url` below, and
        // `parsePodcastRows` reads the same cells, which is why the two must agree.
        //
        // What is NOT here is anywhere an episode's audio lives. This plugin never fetches it — the
        // station does, itself, ahead of the slot — so an enclosure on a CDN nobody named is not a
        // host this plugin has to be allowed.
        network: [
            { fromConfig: 'feeds', ratePerSecond: FEED_RATE_PER_SECOND, bucket: FEED_BUCKET },
            { host: DIRECTORY_HOST, ratePerSecond: DIRECTORY_RATE_PER_SECOND },
        ],
        // Nothing to keep. The station remembers which episodes it fetched and aired, in its own
        // table, because that is a fact about the station rather than about a feed.
        storage: false,
        oauth: false,
    },
    configFields: [
        {
            key: 'feeds',
            label: 'Shows',
            type: 'list',
            required: true,
            placeholder: 'No shows yet.',
            help:
                "One row per show, with the address of its podcast feed: the RSS link a podcast app would subscribe to, not the show's web page. " +
                'The name is optional; leave it empty and the name the show gives itself is used. Search the directory on the Podcasts page to find a feed by name.',
            columns: [
                { key: 'name', label: 'Name', type: 'string', placeholder: 'The show as it calls itself' },
                { key: 'url', label: 'Feed address', type: 'url', required: true, placeholder: 'https://example.com/podcast.xml' },
            ],
        },
        {
            key: 'directory',
            label: 'Search Apple Podcasts for shows',
            type: 'boolean',
            default: DEFAULT_DIRECTORY,
            help:
                "Lets the Podcasts page look a show up by name in Apple's public directory and find its feed. What you type is sent to Apple. " +
                'Turn it off and the station reads only the feeds listed above.',
        },
        {
            key: 'country',
            label: 'Directory country',
            type: 'string',
            placeholder: 'us',
            help: "Which country's directory to search, as two letters (gb, de, au). Empty is the United States.",
        },
        {
            key: 'cacheSeconds',
            label: 'Reuse a feed for (seconds)',
            type: 'number',
            default: DEFAULT_CACHE_SECONDS,
            min: 0,
            max: 86_400,
            help: 'How long a feed already fetched is reused before it is asked for again. Shows publish weekly, so there is rarely a reason to go lower.',
        },
    ],
    configSchema,
};
