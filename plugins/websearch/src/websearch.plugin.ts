import {
    Plugin,
    type AlbumEnrichment,
    type AlbumRef,
    type ArtistEnrichment,
    type ArtistRef,
    type EnrichmentPluginInstance,
    type PluginConnectionResult,
    type SearchPluginInstance,
    type SearchQuery,
    type SearchResult,
    type SourceDocument,
    type TrackEnrichment,
} from '@deadair/plugin-sdk';

import { braveSearch } from './brave.provider.js';
import { searxngSearch } from './searxng.provider.js';
import { tavilySearch } from './tavily.provider.js';
import { albumQuery, artistQuery, documentsFor, parseTrustedSites, type TrustedSite } from './websearch.enrichment.js';
import { hasBudget } from './websearch.http.js';
import { DEFAULT_MAX_DOCUMENTS, DEFAULT_MAX_RESULTS, MAX_DOCUMENTS, REQUEST_TIMEOUT_MS, type ProviderId } from './websearch.manifest.js';

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
 *
 * ## Two capabilities, one supplier, and the second one is off by default
 *
 * `search` answers a question somebody asked. `enrichment` asks its own — what
 * is on the operator's trusted sites about this artist, this record — and hands
 * back the prose the host extracts claims from. They are one plugin because they
 * are one engine and one credential, and separate capabilities because a station
 * may well want the first without the second: searching costs a request, and
 * quoting puts somebody else's sentences into a store the station broadcasts
 * from. With no trusted sites configured, which is the default, the enrichment
 * half answers nothing and makes no requests at all. See
 * `websearch.enrichment.ts` for where the trust actually lives.
 */
export class WebSearchPlugin extends Plugin implements SearchPluginInstance, EnrichmentPluginInstance {
    /**
     * Where this sorts when several sources answer about one record. Lower wins.
     *
     * Behind Wikipedia's canonical 100 and behind an ordinary supplementary
     * source's 500, deliberately: an encyclopaedia article about a record is
     * about that record, and the best page a search engine can find is about
     * that record as far as an index is concerned. Being outranked costs this
     * nothing that matters, since `documents` is a LIST field and the host
     * concatenates rather than choosing.
     */
    readonly priority = 700;

    /**
     * Which of the {@link TrackRef} fields this can match on.
     *
     * Neither, really, and that is the honest answer: see {@link enrichTrack}.
     * The pair is declared because the host asks and an artist name is what the
     * two questions this plugin CAN answer are keyed to.
     */
    readonly matchKeys = ['artist-title' as const];

    private provider?: ProviderId;
    private baseUrl = '';
    private apiKey = '';
    private maxResults = DEFAULT_MAX_RESULTS;
    private trustedSites: TrustedSite[] = [];
    private maxDocuments = DEFAULT_MAX_DOCUMENTS;

    protected async onLoad(): Promise<void> {
        const config = await this.host.config.get();

        this.provider = readProvider(config.provider);
        this.baseUrl = readText(config.baseUrl);
        this.apiKey = readText(config.apiKey);
        this.maxResults = positive(config.maxResults) ?? DEFAULT_MAX_RESULTS;
        this.trustedSites = parseTrustedSites(config.trustedSites);
        this.maxDocuments = Math.min(positive(config.maxDocuments) ?? DEFAULT_MAX_DOCUMENTS, MAX_DOCUMENTS);

        // The key is never logged, and neither is the address: one is a secret
        // and the other is somebody's internal hostname.
        this.host.logger.info('web search ready', {
            engine: this.provider ?? 'none',
            results: this.maxResults,
            trustedSites: this.trustedSites.length,
        });
    }

    protected async onUnload(): Promise<void> {
        this.provider = undefined;
        this.baseUrl = '';
        this.apiKey = '';
        this.trustedSites = [];
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

    /**
     * Nothing, always, and it is not a stub.
     *
     * `enrichTrack` is the one method `ENRICHMENT_METHODS` requires, so a plugin
     * that answers only about artists and records still has to have it. What it
     * would take to answer here is a search per RECORDING, which is a request
     * per track across the whole catalog for facts that almost never belong to
     * the recording: the label, the sessions, the chart run and the story are
     * the record's or the artist's, and those are asked once each on their own
     * walks. Both of those the host runs regardless of what this returns.
     */
    async enrichTrack(): Promise<Partial<TrackEnrichment>> {
        return {};
    }

    /**
     * What the operator's trusted sites say about an artist.
     *
     * One search and up to `maxDocuments` pages. `{}` when there is no engine or
     * no trusted site, which is the default state and costs nothing: no request
     * is made, so a station that never fills the list pays nothing for this
     * capability being declared.
     */
    async enrichArtist(ref: ArtistRef): Promise<Partial<ArtistEnrichment>> {
        const documents = await this.background(artistQuery(ref.name));
        return documents.length === 0 ? {} : { documents };
    }

    /** {@link enrichArtist} for a record, asked once per album rather than once per track. */
    async enrichAlbum(ref: AlbumRef): Promise<Partial<AlbumEnrichment>> {
        const documents = await this.background(albumQuery(ref.name, ref.artist));
        return documents.length === 0 ? {} : { documents };
    }

    /**
     * One subject's background: search the trusted sites, then read what came
     * back.
     *
     * The engine is asked for more results than there are pages to read, because
     * some of what it returns will be a page with no prose on it — a discography
     * listing, a chart table, a photo gallery — and stopping at exactly
     * `maxDocuments` results would leave a subject with nothing over one bad
     * hit. `documentsFor` stops as soon as it has enough.
     *
     * A search that throws costs this subject its documents and nothing else:
     * the enrichment walk goes on to the next artist, and an engine's bad minute
     * must not end it.
     *
     * **The host is captured once, before the first await, and nothing here
     * reads `this.host` after one.** Measured: an operator saving the config
     * mid-walk reinitializes the plugin, `Plugin.dispose` releases the host, and
     * a catch handler that then reached for `this.host.logger` threw
     * "used before init() or after dispose()" — turning a search that simply
     * failed into an invoker failure, three of which quarantine the plugin. The
     * request that was in flight is allowed to finish and be reported; what must
     * not survive the await is the reference.
     */
    private async background(query: string): Promise<SourceDocument[]> {
        if (this.provider === undefined || this.trustedSites.length === 0) return [];

        const host = this.host;
        if (!hasBudget(host, REQUEST_TIMEOUT_MS)) return [];

        const sites = this.trustedSites.map(site => site.hostname);
        const wanted = this.maxDocuments;

        let found: SearchResult[];
        try {
            // Asked for more than there are pages to read: some of what comes
            // back is a discography listing or a photo gallery with no prose on
            // it, and stopping at exactly `wanted` results would leave a subject
            // with nothing over one bad hit.
            found = await this.ask({ query, limit: wanted * 2, sites });
        } catch (error) {
            host.logger.debug('web search: could not look up background', { error: message(error) });
            return [];
        }

        return await documentsFor(host, found, wanted);
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
