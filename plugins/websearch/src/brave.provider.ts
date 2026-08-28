import { jsonBody, type PluginHost, type SearchQuery, type SearchResult } from '@deadair/plugin-sdk';
import { onlyOnSites, readResults, withSites, type RawResult } from './websearch.results.js';
import { refuseResponse } from './websearch.http.js';
import { BRAVE_HOST, REQUEST_TIMEOUT_MS } from './websearch.manifest.js';

/**
 * Brave Search: a managed index, keyed by a subscription token.
 *
 * The one of the three that reliably answers the questions a music station
 * asks. A prior station's issue log has the measurement: for a bare artist name
 * the keyless options returned nothing at all and this returned a page of real
 * hits.
 *
 * Metered, which is why the rate limit and the `Retry-After` matter more here
 * than on a self-hosted instance: the free tier is roughly a thousand queries a
 * month, so a station that searched on every break would exhaust it in a week.
 * What actually protects it is the host's cache in front of this plugin.
 */
const BRAVE_ENDPOINT = `https://${BRAVE_HOST}/res/v1/web/search`;

/** Brave's own name for a freshness window. */
const FRESHNESS = { day: 'pd', week: 'pw', month: 'pm', year: 'py' } as const;

export async function braveSearch(host: PluginHost, apiKey: string, query: SearchQuery): Promise<SearchResult[]> {
    const url = new URL(BRAVE_ENDPOINT);
    // Brave takes `site:` in the query itself; there is no parameter for it.
    url.searchParams.set('q', withSites(query.query, query.sites));
    // Brave's own ceiling on this parameter is 20, and asking for more is a 422
    // rather than a shorter list. Asked for in full even when the sites will cut
    // it down, since the ones that survive are what the caller wanted.
    url.searchParams.set('count', String(Math.min(Math.max(query.limit, 1), 20)));
    // Snippets arrive with the query terms wrapped in `<strong>` unless this is
    // off. `plainText` would strip them anyway; turning them off means the
    // engine sends less rather than this sending more to the stripper.
    url.searchParams.set('text_decorations', '0');
    if (query.recency !== undefined) url.searchParams.set('freshness', FRESHNESS[query.recency]);
    if (query.language !== undefined) url.searchParams.set('search_lang', query.language);

    const response = await host.fetch(url.toString(), {
        timeoutMs: REQUEST_TIMEOUT_MS,
        headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey },
    });

    if (!response.ok) {
        await refuseResponse(response, 'brave', response.status === 401 || response.status === 403 ? 'check the subscription token' : undefined);
    }

    // Filtered before it is cut. See the note in `searxng.provider.ts`.
    return onlyOnSites(parseBraveResponse(await jsonBody<unknown>(response)), query.sites ?? []).slice(0, Math.max(0, query.limit));
}

/**
 * Brave's JSON, as results.
 *
 * Pure and exported separately from the request, so saved responses pin the
 * mapping with no host in the way. Tolerant of anything: a shape it does not
 * recognise yields no results rather than a throw.
 *
 * **News leads, then the web.** Brave answers a query it reads as newsworthy
 * with both, and a station asking about somebody usually wants what happened
 * rather than their biography page. The `infobox` is deliberately ignored, for
 * the reason SearXNG's is: a long description assembled by somebody else is an
 * answer nothing here can check against a source.
 */
export function parseBraveResponse(data: unknown): SearchResult[] {
    const raws: RawResult[] = [];

    for (const section of ['news', 'web'] as const) {
        const results = field(field(data, section), 'results');
        if (!Array.isArray(results)) continue;

        for (const entry of results) {
            raws.push({
                title: field(entry, 'title'),
                snippet: field(entry, 'description'),
                url: field(entry, 'url'),
                // Brave's profile carries the publisher as a person would name
                // it ("The Guardian"), which is better than any hostname.
                site: field(field(entry, 'profile'), 'name'),
                // `page_age` is an ISO instant. `age` beside it is a phrase
                // ("3 days ago") and is not read: see `instant` in
                // `websearch.results.ts` for why a phrase is not a date.
                published: field(entry, 'page_age'),
            });
        }
    }

    return readResults(raws);
}

const field = (value: unknown, key: string): unknown =>
    value !== null && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
