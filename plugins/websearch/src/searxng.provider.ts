import { jsonBody, type PluginHost, type SearchQuery, type SearchResult } from '@deadair/plugin-sdk';
import { readResults, type RawResult } from './websearch.results.js';
import { refuseResponse } from './websearch.http.js';
import { REQUEST_TIMEOUT_MS } from './websearch.manifest.js';

/**
 * SearXNG: a metasearch engine the operator runs themselves.
 *
 * The keyless one, and the reason it leads the list. It holds no account, pays
 * no bill and asks the engines behind it on the station's behalf, which fits a
 * station that already self-hosts its own model and its own voice.
 *
 * The one thing worth knowing before pointing anything at an instance: **the
 * JSON format is off by default**. A SearXNG whose `settings.yml` does not list
 * `json` under `search.formats` answers a `format=json` query with a 403, which
 * reads exactly like a broken address unless you know. That is why the failure
 * is reported rather than swallowed here, and why `testConnection` exists.
 */
export async function searxngSearch(host: PluginHost, baseUrl: string, query: SearchQuery): Promise<SearchResult[]> {
    const url = new URL('/search', baseUrl.replace(/\/+$/, ''));
    url.searchParams.set('q', query.query);
    url.searchParams.set('format', 'json');
    if (query.recency !== undefined) url.searchParams.set('time_range', query.recency);
    if (query.language !== undefined) url.searchParams.set('language', query.language);

    const response = await host.fetch(url.toString(), { timeoutMs: REQUEST_TIMEOUT_MS, headers: { Accept: 'application/json' } });

    // The 403 is named because it is the one an operator cannot diagnose from
    // the status alone, and it is the commonest way this fails.
    if (!response.ok) {
        await refuseResponse(
            response,
            'searxng',
            response.status === 403 ? 'an instance that has not enabled the json output format answers exactly this' : undefined,
        );
    }

    return parseSearxngResponse(await jsonBody<unknown>(response), query.limit);
}

/**
 * SearXNG's JSON, as results.
 *
 * Pure and exported separately from the request, so saved responses pin the
 * mapping with no host in the way — `parseFeed`'s split, for `parseFeed`'s
 * reason. Tolerant of anything: a shape it does not recognise yields no results
 * rather than a throw, because the alternative is one field rename upstream
 * taking the station's whole ability to search with it.
 *
 * `infoboxes` is deliberately ignored. It is the closest thing SearXNG has to an
 * ANSWER, and an answer is a paragraph assembled from pages this station never
 * sees, which nothing here can check against a source. See `capabilities/search.ts`.
 */
export function parseSearxngResponse(data: unknown, limit: number): SearchResult[] {
    const results = field(data, 'results');
    if (!Array.isArray(results)) return [];

    const raws: RawResult[] = results.map(entry => ({
        title: field(entry, 'title'),
        snippet: field(entry, 'content'),
        url: field(entry, 'url'),
        // No publisher name anywhere in the shape, so the host stands in for one.
        published: field(entry, 'publishedDate'),
    }));

    return readResults(raws).slice(0, Math.max(0, limit));
}

const field = (value: unknown, key: string): unknown =>
    value !== null && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
