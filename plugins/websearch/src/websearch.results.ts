import { plainText, type SearchResult } from '@deadair/plugin-sdk';

/**
 * Turning what an engine sent into what the station takes, once.
 *
 * The three engines differ in almost every field name and agree on the shape,
 * so what is shared here is the CLEANING rather than the mapping: every one of
 * them will hand over markup in a snippet, a date it is guessing at, and a
 * result with no title, and answering those three questions differently in
 * three files is how a station ends up with a presenter reading `&#x27;` out
 * loud from one engine and not another.
 */

/**
 * How much of a snippet is kept.
 *
 * An engine's extract is two or three sentences, and the ones that run longer
 * are running long because the page is a listing rather than an article. What
 * reads this is a model with a persona sheet and a set of content rules already
 * in its context.
 */
export const SNIPPET_MAX_CHARS = 400;

/** One result as an engine described it, before this file has had a look at it. */
export interface RawResult {
    title?: unknown;
    snippet?: unknown;
    url?: unknown;
    /** The engine's own name for the publisher, where it has one. */
    site?: unknown;
    /** Whatever the engine called a date. Parsed here, and dropped when it will not parse. */
    published?: unknown;
}

/**
 * One cleaned result, or `undefined` when there was not one there.
 *
 * A hit with no title or no address is dropped rather than passed on with a
 * hole: the host de-duplicates on the URL and cites it, and a model reads the
 * title. A hit with no SNIPPET is kept, because a title and an address are still
 * a page somebody can go and read.
 */
export function readResult(raw: RawResult): SearchResult | undefined {
    const title = plainText(text(raw.title) ?? '');
    const url = text(raw.url);
    if (title === undefined || url === undefined || !isWebAddress(url)) return undefined;

    const snippet = plainText(text(raw.snippet) ?? '', SNIPPET_MAX_CHARS);
    const site = text(raw.site) ?? hostOf(url);
    const publishedAt = instant(raw.published);

    return {
        title,
        snippet: snippet ?? '',
        url,
        ...(site === undefined ? {} : { site }),
        ...(publishedAt === undefined ? {} : { publishedAt }),
    };
}

/** {@link readResult} over a list, dropping what it could not read and holding the engine's order. */
export const readResults = (raws: readonly RawResult[]): SearchResult[] =>
    raws.map(readResult).filter((result): result is SearchResult => result !== undefined);

/**
 * The publisher, for a result whose engine did not name one.
 *
 * The hostname without its `www.`, which is what a presenter would say. It is a
 * fallback rather than a guess at a brand: turning `bbc.co.uk` into "the BBC" is
 * a table somebody has to maintain and be wrong about, and the host that served
 * the page is a fact.
 */
export function hostOf(url: string): string | undefined {
    try {
        return new URL(url).hostname.replace(/^www\./i, '') || undefined;
    } catch {
        return undefined;
    }
}

/**
 * An engine's idea of when something was published, as ISO-8601.
 *
 * Dropped rather than guessed at when it will not parse, and that is the whole
 * rule: engines report ages as much as dates (Brave's `age` is "3 days ago"),
 * and a station that turned a relative phrase into an instant would be stating a
 * date nobody published. Absent is the ordinary case and every caller handles it.
 */
function instant(value: unknown): string | undefined {
    const raw = text(value);
    if (raw === undefined) return undefined;

    const parsed = Date.parse(raw);
    if (Number.isNaN(parsed)) return undefined;
    return new Date(parsed).toISOString();
}

/** Whether an address is one anything could fetch, or cite. */
function isWebAddress(url: string): boolean {
    try {
        const { protocol } = new URL(url);
        return protocol === 'http:' || protocol === 'https:';
    } catch {
        return false;
    }
}

/**
 * The query with `site:` clauses on it, for the engines that take operators.
 *
 * `OR`ed rather than one search per site, because the alternative is a request
 * per entry on a list an operator can make as long as they like. Every engine
 * that supports the operator at all supports this form of it.
 *
 * Bounded, and it has to be: a query with thirty operators in it is one most
 * engines answer with nothing at all rather than with an error, which reads as
 * "there is nothing about this" and is the worst failure available here. The
 * caller filters what comes back anyway, so a site past the bound loses its
 * boost rather than its eligibility.
 */
export function withSites(query: string, sites: readonly string[] | undefined): string {
    const clauses = (sites ?? []).slice(0, MAX_SITE_CLAUSES).map(site => `site:${site}`);
    return clauses.length === 0 ? query : `${query} ${clauses.join(' OR ')}`;
}

/** How many `site:` clauses one query carries. See {@link withSites}. */
export const MAX_SITE_CLAUSES = 6;

/**
 * Results whose page is on one of these hostnames.
 *
 * Applied by the caller after the engine has answered, whatever the engine was
 * asked: an operator scoping a search is usually about to do something with the
 * pages, and "the engine understood the operator" is not something any of them
 * reports. A subdomain counts — `www.example.com` and `press.example.com` are
 * both `example.com` as far as an operator naming a site is concerned.
 */
export function onlyOnSites(results: readonly SearchResult[], sites: readonly string[]): SearchResult[] {
    if (sites.length === 0) return [...results];

    const allowed = sites.map(site => site.toLowerCase().replace(/^www\./, ''));
    return results.filter(result => {
        const host = hostOf(result.url)?.toLowerCase();
        if (host === undefined) return false;
        return allowed.some(site => host === site || host.endsWith(`.${site}`));
    });
}

const text = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
};
