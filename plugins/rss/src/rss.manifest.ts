import { type PluginManifest } from '@deadair/plugin-sdk';
import { z } from 'zod';

export const PLUGIN_ID = 'deadair.rss';
export const PLUGIN_VERSION = '0.0.1';

/**
 * Per-request budget.
 *
 * A feed is a small static file behind a CDN, so this is generous rather than
 * tuned: the case it covers is a publisher having a bad minute, and a ceiling
 * is not a reservation — the host caps every fetch by whatever is left of the
 * current invocation anyway.
 */
export const REQUEST_TIMEOUT_MS = 8_000;

/**
 * Per-request budget for an article page.
 *
 * Shorter than a feed's, and deliberately the other way round from what the
 * sizes suggest. A feed is the thing without which this plugin answers nothing,
 * so it is worth waiting for; a story is an improvement on a headline the caller
 * already has, and a bulletin is waiting on the whole call. Better three stories
 * read than four with the fourth holding up the break.
 */
export const ARTICLE_TIMEOUT_MS = 5_000;

/**
 * One request a second across every feed on the list, sharing one bucket.
 *
 * The rate being paced here is this station's OUTBOUND rate and not any one
 * publisher's limit, which is why a single bucket is right: a list of twenty
 * feeds refreshing at once is the behaviour worth flattening, and no publisher
 * on it is being asked for more than one file.
 */
export const FEED_RATE_PER_SECOND = 1;
export const FEED_BUCKET = 'rss';

/** Entries per feed, when the operator has not said. Roughly a front page. */
export const DEFAULT_MAX_ITEMS = 25;

/**
 * How long a fetched feed is reused, in seconds.
 *
 * A minute, because the failure this exists for is small and immediate: a model
 * writing one break may call the news tool twice, and asking a publisher twice
 * inside ten seconds is rude for no gain. It is deliberately NOT sized to how
 * often news happens — a caller that wants to know what is new asks more often
 * than this, and gets repeats rather than gaps, which its ids already handle.
 */
export const DEFAULT_CACHE_SECONDS = 60;

/**
 * Whether the story behind a headline is read, when the operator has not said.
 *
 * On, because off is what the station already did and it is what produced a
 * bulletin of titles. It is a switch rather than a constant because it is the
 * one thing here that costs a request per story: an operator on a metered
 * connection, or one whose publisher refuses this, turns it off and gets the
 * old behaviour rather than a broken one.
 */
export const DEFAULT_FETCH_ARTICLES = true;

export const configSchema = z.object({
    /**
     * The rows, as the JSON array a `list` field is stored as.
     *
     * Refused here rather than read leniently, unlike everywhere else this value is touched: a save
     * is the one moment there is somebody to tell. `parseFeedRows` and the host's allowlist both
     * drop what they cannot read, which is right on the way in to a running station and wrong as
     * the only answer an operator ever gets — a feeds box that saved cleanly and served nothing is
     * exactly the failure the rows replaced lines to end.
     */
    feeds: z
        .string()
        .default('[]')
        .refine(value => value.trim().length === 0 || readsAsFeedRows(value), 'Each feed needs a web address starting with http:// or https://'),
    maxItems: z.coerce.number().int().min(1).max(100).default(DEFAULT_MAX_ITEMS),
    cacheSeconds: z.coerce.number().int().min(0).max(3_600).default(DEFAULT_CACHE_SECONDS),
    fetchArticles: z.coerce.boolean().default(DEFAULT_FETCH_ARTICLES),
});

export type RssConfig = z.infer<typeof configSchema>;

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

export const rssManifest: PluginManifest = {
    id: PLUGIN_ID,
    name: 'RSS',
    version: PLUGIN_VERSION,
    capabilities: ['news'],
    apiVersion: '^1.0.0',
    description: 'Reads the RSS and Atom feeds you point it at, so the station has something true to say about the world.',
    permissions: {
        // Every upstream here is one the operator named, so there is no hostname
        // to write down at authoring time and this single entry is the whole
        // allowlist. The host reads a hostname per ROW out of the same setting
        // `parseFeedRows` reads, off the column declared `url` below, which is
        // why the two must agree: a feed the menu offers and the allowlist
        // refuses looks like a broken plugin rather than a row typed wrong.
        network: [{ fromConfig: 'feeds', ratePerSecond: FEED_RATE_PER_SECOND, bucket: FEED_BUCKET }],
        // The one thing this plugin needs that no manifest can name in advance.
        // A feed's entries are on the publisher's feed host and the stories they
        // point at are on the publisher's site, and which site that is depends on
        // what the operator pasted — so the allowlist above resolves to exactly
        // the one hostname that does NOT hold the news. Refused until answered,
        // in which case the station reads headlines and teasers as it always did.
        grants: [
            {
                capability: 'network.open',
                reason: 'Opens the page each headline links to, so a bulletin can say what happened rather than reading out titles. The stories are on whatever sites your feeds point at, which only the feeds know.',
                ratePerSecond: FEED_RATE_PER_SECOND,
                bucket: FEED_BUCKET,
            },
        ],
        // Nothing to keep. What was published is the publisher's, and what the
        // station did with it belongs to the station: a cache lives for a minute
        // in memory and anything longer would be this plugin holding a second
        // copy of somebody else's file.
        storage: false,
        oauth: false,
    },
    configFields: [
        {
            key: 'feeds',
            label: 'Feeds',
            type: 'list',
            required: true,
            placeholder: 'No feeds yet.',
            help:
                'One row per feed. The address is the only part that is needed: leave the name empty and the publisher is used, and leave the ' +
                'category empty and the stories are sorted by what they say rather than by where they came from. A category here is the surest ' +
                'way to say what a feed is, since a publisher who has already sorted their own newsroom has done the work.',
            columns: [
                { key: 'name', label: 'Name', type: 'string', placeholder: 'World news' },
                { key: 'url', label: 'Address', type: 'url', required: true, placeholder: 'https://example.com/rss.xml' },
                { key: 'category', label: 'Category', type: 'string', placeholder: 'Any', optionsFrom: 'station.newsCategories' },
            ],
        },
        {
            key: 'maxItems',
            label: 'Headlines per feed',
            type: 'number',
            default: DEFAULT_MAX_ITEMS,
            help: 'How far down each feed to read. Newest first, so this is really how much of the front page the station can see.',
        },
        {
            key: 'fetchArticles',
            label: 'Read the story, not just the headline',
            type: 'boolean',
            default: DEFAULT_FETCH_ARTICLES,
            help:
                "A feed usually carries titles and a one-line teaser, so a bulletin built from it alone reads out a list. With this on, the station also opens each story's own page and keeps its paragraphs, which is what a presenter needs to say what actually happened. " +
                'The stories are on a different address from the feed, so this needs the open web allowed under what this plugin has asked for, below. Costs one request per story read, and never more than four per bulletin.',
        },
        {
            key: 'cacheSeconds',
            label: 'Reuse a feed for (seconds)',
            type: 'number',
            default: DEFAULT_CACHE_SECONDS,
            help: 'How long a feed already fetched is reused before it is asked for again. Stops one break that mentions the news twice from fetching twice. Set it to 0 to fetch every time.',
        },
    ],
    configSchema,
};
