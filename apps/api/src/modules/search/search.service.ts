import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import type { SearchRecency, SearchResult } from '@deadair/plugin-sdk';
import { asSearchPlugin, type SearchPlugin } from '#modules/plugins/plugin.capabilities.js';
import { byPluginId, pluginsWith } from '#modules/plugins/plugin.selection.js';
import { PluginInvoker } from '#modules/plugins/plugin.invoker.js';
import { PluginRegistry } from '#modules/plugins/plugin.registry.js';
import { errorText } from '#modules/shared/error.text.js';

/**
 * What the open web says about something, out of whatever search plugins are
 * installed.
 *
 * ## It answers an OPEN question, which is what separates it from the news
 *
 * `NewsService` next door serves a menu an operator assembled and answers "what
 * happened". This is handed a subject somebody else chose and has no idea what
 * will come back — so there are no feed ids to qualify, nothing stable to
 * de-duplicate across calls, and no operator vocabulary to filter against. What
 * there is instead is a cache, because the same question really does get asked
 * twice.
 *
 * ## Two engines are overlapping pages, not rival accounts
 *
 * So results from several plugins are combined, unlike news, and de-duplicated
 * by URL. What is NOT combined is any judgement about which is better: engines
 * score relevance against indexes this host cannot see, so the order within one
 * plugin's answer is that plugin's and the order across two is the order the
 * plugins were asked in.
 *
 * ## Nothing here airs, and nothing here can be played
 *
 * A result is a page. Whether any of it is spoken is a break writer's decision
 * on a station that is on air, and the pick path never sees any of this — which
 * is the boundary that keeps a search engine from being able to programme an
 * hour.
 *
 * ## A plugin that cannot answer contributes nothing
 *
 * Every call into a plugin is caught and logged rather than thrown, the same
 * rule {@link NewsService} and `ToolRegistry` apply: an engine having a bad
 * minute costs its own results and not the caller's whole question.
 */
@Injectable()
export class SearchService {
    /**
     * SINGLETON state on a SCOPED service, for `SimilarityService`'s reason and
     * it is the one thing here that would be a bug any other way.
     *
     * The service is registered scoped like every other plugin consumer, so a
     * new instance exists per request and per job run. A cache on the instance
     * would be empty every time it was read — not a slow cache but no cache at
     * all — while still looking like one in any test that used a single
     * instance.
     */
    private static readonly cache = new Map<string, CacheEntry>();

    constructor(
        private readonly pluginRegistry: PluginRegistry,
        private readonly pluginInvoker: PluginInvoker,
        private readonly logger: Logger,
    ) {}

    /** Whether anything can answer at all, for a caller deciding whether to offer the feature. */
    hasSearch(): boolean {
        return this.plugins().length > 0;
    }

    /**
     * Ask the web, best first within each engine that answered.
     *
     * `[]` covers every way of having no answer — nothing installed, an engine
     * that is down, a rate limit, a query nothing matched — because they are one
     * outcome to every caller here and the log line is where the difference
     * lives.
     */
    async search(query: string, limit: number, options: SearchOptions = {}): Promise<SearchResult[]> {
        const asked = query.trim();
        if (asked.length === 0) return [];

        const wanted = clampLimit(limit);
        const key = cacheKey(asked, options);

        const cached = SearchService.cache.get(key);
        if (cached !== undefined && Date.now() - cached.at < SEARCH_TTL_MS) return cached.results.slice(0, wanted);

        const collected: SearchResult[] = [];
        const seen = new Set<string>();

        for (const plugin of this.plugins()) {
            // Every plugin is asked for the CEILING rather than for what this
            // caller wanted, which is what makes the cache honest: an answer
            // stored against a limit of three would be served to the next caller
            // who asked for twenty, and it would look like an engine that found
            // three things. One request either way, so the only cost is a longer
            // list this process then trims.
            for (const result of await this.ask(plugin, asked, MAX_SEARCH_RESULTS, options)) {
                const address = dedupeKey(result.url);
                if (address === undefined || seen.has(address)) continue;
                seen.add(address);
                collected.push(result);
            }
        }

        // Cached even when it is empty, and deliberately: "nothing matched" is
        // the answer most likely to be asked for twice in one break, and asking
        // an engine again inside the window would not change it. A plugin that
        // FAILED is a different case and is not distinguishable here, which
        // costs at most one window of a station that could have retried.
        this.remember(key, collected);

        return collected.slice(0, wanted);
    }

    /**
     * One plugin's answer, defended and cleaned.
     *
     * The cleaning is not cosmetic: a result with no URL cannot be
     * de-duplicated, cited or checked against an allowlist, and one with no
     * title is a row a model cannot read. Both are dropped rather than passed on
     * as holes.
     */
    private async ask(plugin: SearchPlugin, query: string, limit: number, options: SearchOptions): Promise<SearchResult[]> {
        try {
            const results = await this.pluginInvoker.invoke(plugin.record.id, 'search.search', async () =>
                plugin.instance.search({
                    query,
                    limit,
                    ...(options.recency === undefined ? {} : { recency: options.recency }),
                    ...(options.language === undefined ? {} : { language: options.language }),
                }),
            );

            return (results ?? []).filter(result => result?.title?.trim() && result.url?.trim());
        } catch (error) {
            this.logger.info(`search: an engine could not be asked (${plugin.record.id}: ${errorText(error)})`);
            return [];
        }
    }

    /** Keep an answer, evicting the oldest once the map is full. */
    private remember(key: string, results: SearchResult[]): void {
        if (SearchService.cache.size >= SEARCH_CACHE_MAX) {
            // Insertion order, which for a Map is oldest first. Crude, and right
            // for a bound whose whole job is to stop a station that has been up
            // for a month holding every question it has ever asked.
            const oldest = SearchService.cache.keys().next();
            if (!oldest.done) SearchService.cache.delete(oldest.value);
        }
        SearchService.cache.set(key, { at: Date.now(), results });
    }

    /** Every plugin that can search right now, in a stable order. */
    private plugins(): SearchPlugin[] {
        return pluginsWith(this.pluginRegistry.list(), asSearchPlugin).sort(byPluginId);
    }
}

/** What a caller can say about the answer it wants, beyond the words themselves. */
export interface SearchOptions {
    /** Only results this recent, where the engine can filter. */
    recency?: SearchRecency;
    /** ISO 639-1. */
    language?: string;
}

/**
 * How many results one question may be asked for.
 *
 * A ceiling rather than a page size, `MAX_NEWS_ITEMS`'s rule: this number
 * reaches somebody else's service, and a caller that asks for a thousand is
 * asking a search engine for a thousand.
 */
export const MAX_SEARCH_RESULTS = 25;

/**
 * How long an answer is reused.
 *
 * Fifteen minutes, and the failure it exists for is small and immediate: one
 * break that mentions a subject twice, or a pass that works through a handful of
 * characters who share an interest, would otherwise ask the same engine the same
 * question inside a minute. It is deliberately NOT sized to how fast the web
 * changes — a caller that wants what is new asks with a `recency`, which is part
 * of the key.
 *
 * Both predecessors landed on the same shape for the same reason; subwave's memo
 * was half an hour and is the closest measured number anybody here has.
 */
export const SEARCH_TTL_MS = 15 * 60 * 1000;

/**
 * How many questions are remembered at once.
 *
 * Small, because unlike an artist cache there is no working set to hold: the
 * questions a station asks are open-ended and mostly never repeat, so this is a
 * bound on a leak rather than a hit-rate target.
 */
export const SEARCH_CACHE_MAX = 200;

interface CacheEntry {
    at: number;
    results: SearchResult[];
}

/**
 * What makes two questions the same question.
 *
 * The recency and the language are in it because they change the answer: a
 * caller asking for this week's news about somebody must not be served the
 * general answer somebody else asked for a minute ago. The LIMIT is not,
 * because every engine is asked for the ceiling and what is stored is always
 * the full answer, which each caller then trims to what it wanted.
 */
const cacheKey = (query: string, options: SearchOptions): string => `${options.recency ?? ''}\n${options.language ?? ''}\n${query.toLowerCase()}`;

/**
 * A URL as an identity, so two engines' copies of one page collapse.
 *
 * Only the parts that decide which page it is: scheme differences and a
 * trailing slash are noise, and a query string is not — it is frequently the
 * whole address of an article. Tracking parameters are left alone, since
 * stripping them by guesswork risks turning two pages into one.
 */
function dedupeKey(url: string): string | undefined {
    try {
        const parsed = new URL(url.trim());
        const path = parsed.pathname.replace(/\/+$/, '');
        return `${parsed.host.toLowerCase()}${path.toLowerCase()}${parsed.search}`;
    } catch {
        return undefined;
    }
}

const clampLimit = (value: number): number => {
    if (!Number.isFinite(value)) return MAX_SEARCH_RESULTS;
    return Math.min(Math.max(Math.floor(value), 1), MAX_SEARCH_RESULTS);
};
