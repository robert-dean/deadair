import { PLUGIN_CAPABILITY_SEARCH, type PluginManifest } from '@deadair/plugin-sdk';
import { z } from 'zod';

export const PLUGIN_ID = 'deadair.websearch';
export const PLUGIN_VERSION = '0.0.1';

/**
 * Which engine answers.
 *
 * Three arms, and the discriminator exists for `plugins/llm`'s reason: a second
 * engine should be a dependency, a branch and an option rather than a second
 * plugin, because what an operator is choosing is not a feature but a supplier.
 *
 * There is no keyless default, which is the one thing about this list somebody
 * will want to change. A search plugin that worked out of the box would be worth
 * a great deal, and the only candidate is DuckDuckGo's Instant Answer API, which
 * is documented, free, and answers almost nothing: it serves entity and
 * definition lookups, so for the queries a station actually asks — an artist, a
 * record, a place — it returns an empty document. Two earlier stations shipped
 * with it and both recorded the same finding. A default that is present and
 * silent is worse than no default, because the operator cannot tell it from a
 * quiet week.
 */
export const PROVIDERS = {
    searxng: 'SearXNG (self-hosted)',
    brave: 'Brave Search',
    tavily: 'Tavily',
} as const;

export type ProviderId = keyof typeof PROVIDERS;

const PROVIDER_IDS = Object.keys(PROVIDERS) as [ProviderId, ...ProviderId[]];

/** Which providers need a key, as opposed to an address the operator runs. */
export const KEYED_PROVIDERS: readonly ProviderId[] = ['brave', 'tavily'];

/** Where a SearXNG instance usually answers inside a compose network. A placeholder in the form only. */
export const DEFAULT_SEARXNG_BASE_URL = 'http://searxng:8080';

export const BRAVE_HOST = 'api.search.brave.com';
export const TAVILY_HOST = 'api.tavily.com';

/**
 * Per-request budget for a query.
 *
 * Shorter than a feed's, because of who is waiting: a model holds the station's
 * single generation slot from its first tool call to its last, so an engine
 * having a slow minute costs a whole break rather than a page of headlines. A
 * ceiling is not a reservation — the host caps every fetch by whatever is left
 * of the current invocation anyway.
 */
export const REQUEST_TIMEOUT_MS = 8_000;

/**
 * Per-request budget for a page whose prose is being read.
 *
 * Longer than a query, and the other way round from `plugins/rss`'s pair on
 * purpose. There, a story is an improvement on a headline the caller already
 * has. Here, the page IS the answer: an enrichment walk with no document has
 * nothing to show for the search it just paid for, and it runs in the
 * background where nobody is waiting on a microphone.
 */
export const ARTICLE_TIMEOUT_MS = 10_000;

/**
 * One request a second across every engine and every page, sharing one bucket.
 *
 * The rate being paced is this station's OUTBOUND rate rather than any one
 * service's published limit, which is why a single bucket is right: only one
 * engine is ever configured, and the pages read afterwards are on the operator's
 * own short list of sites.
 */
export const RATE_PER_SECOND = 1;
export const BUCKET = 'websearch';

/** Results per query, when the operator has not said. */
export const DEFAULT_MAX_RESULTS = 10;

export const configSchema = z
    .object({
        provider: z.enum(PROVIDER_IDS),
        baseUrl: z.string().optional(),
        apiKey: z.string().optional(),
        maxResults: z.coerce.number().int().min(1).max(25).default(DEFAULT_MAX_RESULTS),
    })
    // Refused at SAVE time rather than read leniently later, for `plugins/rss`'s
    // reason: this is the one moment there is somebody looking at the form to
    // tell. A plugin saved without its credential is a station that searches,
    // finds nothing, and reports the world as quiet.
    .refine(config => config.provider !== 'searxng' || hasText(config.baseUrl), {
        path: ['baseUrl'],
        message: 'SearXNG needs the address of your instance, e.g. http://searxng:8080',
    })
    .refine(config => !KEYED_PROVIDERS.includes(config.provider) || hasText(config.apiKey), {
        path: ['apiKey'],
        message: 'This engine needs an API key',
    });

export type WebSearchConfig = z.infer<typeof configSchema>;

const hasText = (value: string | undefined): boolean => typeof value === 'string' && value.trim().length > 0;

export const websearchManifest: PluginManifest = {
    id: PLUGIN_ID,
    name: 'Web search',
    version: PLUGIN_VERSION,
    capabilities: [PLUGIN_CAPABILITY_SEARCH],
    apiVersion: '^1.0.0',
    description: 'Asks a search engine about whatever the station wants to know, so a presenter has something true to work from.',
    permissions: {
        network: [
            // The operator's own instance, wherever they run it. Contributes no
            // entry at all when the field is empty, which is exactly right: an
            // unconfigured plugin is refused as though it had named no host.
            { fromConfig: 'baseUrl', ratePerSecond: RATE_PER_SECOND, bucket: BUCKET },
            // The two managed engines, named outright because their addresses
            // are not an operator's business.
            { host: BRAVE_HOST, ratePerSecond: RATE_PER_SECOND, bucket: BUCKET },
            { host: TAVILY_HOST, ratePerSecond: RATE_PER_SECOND, bucket: BUCKET },
        ],
        // Nothing to keep. A result is somebody else's page and the questions
        // the station asks are the station's; the cache that stops one break
        // asking twice lives in the host, in front of this.
        storage: false,
        oauth: false,
    },
    configFields: [
        {
            key: 'provider',
            label: 'Engine',
            type: 'select',
            required: true,
            options: Object.entries(PROVIDERS).map(([value, label]) => ({ value, label })),
            help:
                'SearXNG is self-hosted and needs no account, so it is the one to reach for if you already run an instance (it must have the ' +
                'JSON format enabled in its settings, which is off by default). Brave and Tavily are paid services and need a key below.',
        },
        {
            key: 'baseUrl',
            label: 'SearXNG address',
            type: 'url',
            placeholder: DEFAULT_SEARXNG_BASE_URL,
            help: 'Where your own instance answers. Ignored by the other engines. This is also the only address this plugin is allowed to reach for them.',
        },
        {
            key: 'apiKey',
            label: 'API key',
            type: 'secret',
            help: 'Brave calls this a subscription token and Tavily an API key. Not needed for SearXNG, which has no account to hold one.',
        },
        {
            key: 'maxResults',
            label: 'Results per search',
            type: 'number',
            default: DEFAULT_MAX_RESULTS,
            min: 1,
            max: 25,
            help:
                'How many hits to bring back. Ten is about as much as a presenter can use: what reads them is a model writing a sentence or two, ' +
                'and forty results is a page of context spent on something the station was asked to mention once.',
        },
    ],
    configSchema,
};
