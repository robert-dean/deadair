import { Plugin, type PluginConnectionResult, type SearchPluginInstance, type SearchQuery, type SearchResult } from '@deadair/plugin-sdk';

import { braveSearch } from './brave.provider.js';
import { searxngSearch } from './searxng.provider.js';
import { tavilySearch } from './tavily.provider.js';
import { hasBudget } from './websearch.http.js';
import { DEFAULT_MAX_RESULTS, REQUEST_TIMEOUT_MS, type ProviderId } from './websearch.manifest.js';

export { websearchManifest } from './websearch.manifest.js';

/**
 * The open web, as something the station can ask.
 *
 * Thin on purpose, like `plugins/rss`. Everything about reaching an engine lives
 * in `host.fetch`, everything about cleaning what comes back lives in
 * `websearch.results.ts`, and the caching that stops one break asking twice
 * lives in the HOST, in front of this. What is left here is the operator's
 * choice of engine and the dispatch to it.
 *
 * ## One engine at a time, and it is the operator's choice
 *
 * There is no fallback to a second engine when the chosen one fails, and that is
 * deliberate rather than unfinished. Only one is credentialed on any given
 * install, so a fallback would be a call to a service with no key attached — and
 * where a station really does want two, installing this plugin twice with
 * different settings is what the host is for.
 *
 * ## A failure here is worth reporting, and the host decides what it costs
 *
 * Unlike a feed reader, which fans out over twenty publishers and can lose one,
 * this has a single upstream: an engine that refused is the whole answer, and
 * swallowing it would report a rate limit as a quiet week. So a bad status
 * throws, `SearchService` turns it into `[]` for its caller, and the operator's
 * log has the reason.
 */
export class WebSearchPlugin extends Plugin implements SearchPluginInstance {
    private provider?: ProviderId;
    private baseUrl = '';
    private apiKey = '';
    private maxResults = DEFAULT_MAX_RESULTS;

    protected async onLoad(): Promise<void> {
        const config = await this.host.config.get();

        this.provider = readProvider(config.provider);
        this.baseUrl = readText(config.baseUrl);
        this.apiKey = readText(config.apiKey);
        this.maxResults = positive(config.maxResults) ?? DEFAULT_MAX_RESULTS;

        // The key is never logged, and neither is the address: one is a secret
        // and the other is somebody's internal hostname.
        this.host.logger.info('web search ready', { engine: this.provider ?? 'none', results: this.maxResults });
    }

    protected async onUnload(): Promise<void> {
        this.provider = undefined;
        this.baseUrl = '';
        this.apiKey = '';
    }

    /**
     * Ask the engine.
     *
     * `[]` for a plugin nobody has configured yet, which is the state every
     * install starts in and is not a fault: the manifest's schema refuses a save
     * without the credential, so an unconfigured plugin is one nobody has opened
     * the form for.
     *
     * The budget check is before the request rather than after, for
     * `plugins/rss`'s reason: being cut off mid-request costs the request and
     * leaves nothing to show for it.
     */
    async search(query: SearchQuery): Promise<SearchResult[]> {
        const asked = query.query.trim();
        if (asked.length === 0 || this.provider === undefined) return [];

        if (!hasBudget(this.host, REQUEST_TIMEOUT_MS)) {
            this.host.logger.debug('web search: not enough of the call left to ask an engine');
            return [];
        }

        return await this.ask({ ...query, query: asked, limit: Math.min(query.limit, this.maxResults) });
    }

    /**
     * Whether the engine actually answers.
     *
     * A real query rather than a ping, because every way this fails fails at the
     * query: SearXNG serves its front page happily and refuses `format=json`,
     * and a wrong key is a 401 on the search endpoint and nowhere else. The
     * subject is a proper noun with a stable, well-indexed page behind it, so a
     * working engine finding nothing means something is wrong.
     */
    async testConnection(): Promise<PluginConnectionResult> {
        if (this.provider === undefined) return { ok: false, message: 'Choose an engine above and give it what it needs.' };

        try {
            const results = await this.ask({ query: 'BBC Radio', limit: 3 });
            if (results.length === 0) {
                return {
                    ok: false,
                    message: `${this.provider} answered, but found nothing at all — which a working engine does not do for this query.`,
                };
            }
            return { ok: true, message: `${this.provider} answered with ${results.length} result${results.length === 1 ? '' : 's'}.` };
        } catch (error) {
            return { ok: false, message: message(error) };
        }
    }

    /** The dispatch, and the only place the credentials are read. */
    private async ask(query: SearchQuery): Promise<SearchResult[]> {
        switch (this.provider) {
            case 'searxng':
                return await searxngSearch(this.host, this.baseUrl, query);
            case 'brave':
                return await braveSearch(this.host, this.apiKey, query);
            case 'tavily':
                return await tavilySearch(this.host, this.apiKey, query);
            default:
                return [];
        }
    }
}

/**
 * The engine, or nothing.
 *
 * Read leniently here where the manifest's schema refuses it, which is the
 * split `plugins/rss` keeps: a save is the one moment there is somebody to tell,
 * and a running station handed a value it cannot read should do nothing rather
 * than throw on every call.
 */
function readProvider(value: unknown): ProviderId | undefined {
    if (value !== 'searxng' && value !== 'brave' && value !== 'tavily') return undefined;
    return value;
}

const readText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const positive = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));
