import { jsonBody, type PluginHost, type SearchQuery, type SearchResult } from '@deadair/plugin-sdk';
import { readResults, type RawResult } from './websearch.results.js';
import { refuseResponse } from './websearch.http.js';
import { REQUEST_TIMEOUT_MS, TAVILY_HOST } from './websearch.manifest.js';

/**
 * Tavily: a search API built for feeding models.
 *
 * What it sells over an ordinary index is the extract: its `content` is a
 * passage chosen for the query rather than the page's meta description, which is
 * exactly what a station wants to read. Keyed and metered like Brave.
 *
 * **`include_answer` is deliberately off.** It is the headline feature of the
 * service and it is the one thing this plugin must not take: the answer is a
 * paragraph somebody else's model wrote about pages this station never sees, so
 * nothing here can check it against a source, and a claim that cannot be checked
 * is one the station must not broadcast. See `capabilities/search.ts`. What is
 * being paid for is the retrieval, and this takes the retrieval.
 */
const TAVILY_ENDPOINT = `https://${TAVILY_HOST}/search`;

/**
 * How far back Tavily is asked to look, in days.
 *
 * Its `days` parameter is a number rather than a window, and it only applies to
 * `topic: 'news'` — which is why the topic moves with the recency: a caller who
 * asked for this week is asking about events, and a caller who did not is asking
 * about a subject.
 */
const DAYS = { day: 1, week: 7, month: 30, year: 365 } as const;

export async function tavilySearch(host: PluginHost, apiKey: string, query: SearchQuery): Promise<SearchResult[]> {
    const body: Record<string, unknown> = {
        query: query.query,
        max_results: Math.max(1, query.limit),
        search_depth: 'basic',
        include_answer: false,
        topic: query.recency === undefined ? 'general' : 'news',
        ...(query.recency === undefined ? {} : { days: DAYS[query.recency] }),
    };

    const response = await host.fetch(TAVILY_ENDPOINT, {
        method: 'POST',
        timeoutMs: REQUEST_TIMEOUT_MS,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        await refuseResponse(response, 'tavily', response.status === 401 || response.status === 403 ? 'check the API key' : undefined);
    }

    return parseTavilyResponse(await jsonBody<unknown>(response), query.limit);
}

/**
 * Tavily's JSON, as results.
 *
 * Pure and exported separately from the request, so saved responses pin the
 * mapping with no host in the way. Tolerant of anything: a shape it does not
 * recognise yields no results rather than a throw.
 *
 * `answer` is ignored even when the request asked for none, because a service
 * is free to send one anyway and this is the file that would have to notice.
 * `score` is ignored too: it orders the list Tavily already ordered.
 */
export function parseTavilyResponse(data: unknown, limit: number): SearchResult[] {
    const results = field(data, 'results');
    if (!Array.isArray(results)) return [];

    const raws: RawResult[] = results.map(entry => ({
        title: field(entry, 'title'),
        snippet: field(entry, 'content'),
        url: field(entry, 'url'),
        // Only present on news results, and only sometimes. No publisher name
        // anywhere in the shape, so the host stands in for one.
        published: field(entry, 'published_date'),
    }));

    return readResults(raws).slice(0, Math.max(0, limit));
}

const field = (value: unknown, key: string): unknown =>
    value !== null && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
