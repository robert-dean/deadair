import { fetchArticle, parseRows, type PluginHost, type SearchResult, type SourceDocument } from '@deadair/plugin-sdk';

import { hostOf } from './websearch.results.js';
import { hasBudget } from './websearch.http.js';
import { ARTICLE_TIMEOUT_MS, DOCUMENT_MAX_CHARS } from './websearch.manifest.js';

/**
 * Turning a search into prose the station can make claims from.
 *
 * ## The trust boundary is the HOST's allowlist, not a check in this file
 *
 * A search result can point anywhere, and a station that read whatever an engine
 * ranked first would be minting facts out of whichever page won an SEO contest
 * that morning. So the operator names the sites, the manifest points
 * `permissions.network` at that same field, and `host.fetch` refuses everything
 * else — before this code runs, and whatever this code asks for. The filtering
 * here is a cheaper way of reaching the same answer, never the thing that makes
 * it true: delete every line of it and the plugin still cannot open a page the
 * operator did not name.
 *
 * That is why there is no `network.open` grant in the manifest and must not be
 * one. A grant would make this a plugin that reads the open web and promises to
 * be careful, which is a different plugin.
 *
 * ## An empty list is the default, and it means this half does nothing
 *
 * Searching is useful the moment an engine is configured. Reading pages puts
 * somebody else's prose into a store the station draws on-air claims from, which
 * is a decision to make site by site.
 *
 * ## It hands over prose and never a summary of it
 *
 * `capabilities/enrichment.ts`'s rule: the host stores the document, extracts
 * claims from it, and checks each claim's quoted span against the text it came
 * from. A span that does not occur is dropped. Prose that has been through a
 * plugin's own paraphrase is prose nothing can check, so nothing here rewrites,
 * joins or condenses — `extractArticle` takes the furniture out and stops.
 */

/** One site the operator trusts, as the rows of the `list` field hold it. */
export interface TrustedSite {
    /** Bare hostname, which is what a `site:` clause and an allowlist both want. */
    hostname: string;
    /** What the operator called it. Unused by anything but a log line. */
    name?: string;
}

/**
 * The operator's list, as hostnames.
 *
 * `parseRows` is the SDK's own reader, so this and the host's allowlist read one
 * encoding — a site the plugin searches and the allowlist refuses would look
 * like a broken plugin rather than a row typed wrong. A row this cannot read is
 * dropped rather than throwing, because the schema already refused it at save
 * time and a running station handed something odd should do less, not fail.
 */
export function parseTrustedSites(raw: unknown): TrustedSite[] {
    const sites: TrustedSite[] = [];
    const seen = new Set<string>();

    for (const row of parseRows(raw)) {
        const hostname = hostOf(row.site ?? '')?.toLowerCase();
        if (hostname === undefined || seen.has(hostname)) continue;
        seen.add(hostname);
        sites.push({ hostname, ...(row.name === undefined || row.name.length === 0 ? {} : { name: row.name }) });
    }

    return sites;
}

/**
 * The pages behind these results, as documents.
 *
 * Three bounds, and each one is a different failure being avoided. `maximum`
 * stops one record costing five requests to somebody's server. The budget check
 * stops a walk being cut off mid-page with nothing to show for the request it
 * just spent. And a page that fails costs its own document and nothing else —
 * a refused host, a PDF, a page with no prose on it and a publisher having a bad
 * minute all leave the others intact, because on this path having two documents
 * instead of three is not a failure at all.
 */
export async function documentsFor(host: PluginHost, results: readonly SearchResult[], maximum: number): Promise<SourceDocument[]> {
    const documents: SourceDocument[] = [];

    for (const result of results) {
        if (documents.length >= maximum) break;

        // Before starting one rather than after, for `plugins/rss`'s reason.
        if (!hasBudget(host, ARTICLE_TIMEOUT_MS)) {
            host.logger.debug('web search: stopped short of the pages, out of budget', { read: documents.length });
            break;
        }

        const text = await readPage(host, result.url);
        if (text === undefined) continue;

        documents.push({ url: result.url, title: result.title, text, retrievedAt: new Date().toISOString() });
    }

    return documents;
}

/**
 * One page's prose, or nothing.
 *
 * Every way of having no prose is the same answer, because they are the same
 * outcome to the host: a page that is a photo gallery, one that is a PDF, one
 * the allowlist refused, and one whose server is down all leave this subject
 * with one fewer document, which is an ordinary state.
 *
 * The refusal is logged at debug and names the host rather than the error,
 * because the useful half for an operator is which site it was — a site on the
 * list that never yields a page is a row worth removing.
 */
async function readPage(host: PluginHost, url: string): Promise<string | undefined> {
    try {
        return await fetchArticle(host, url, { timeoutMs: ARTICLE_TIMEOUT_MS }, { maxChars: DOCUMENT_MAX_CHARS });
    } catch (error) {
        host.logger.debug('web search: a page could not be read', {
            site: hostOf(url) ?? 'unknown',
            error: error instanceof Error ? error.message : String(error),
        });
        return undefined;
    }
}

/**
 * What to search for, to find background on somebody.
 *
 * Plain words rather than an operator-laden query, because the `site:` clauses
 * are added separately and an engine handed both a phrase in quotes and six
 * operators frequently answers with nothing. The disambiguator matters more than
 * it looks: a bare artist name on a music encyclopaedia matches every record
 * they appear on, and the word that follows is what decides whether the page
 * that comes back is about the artist or about a compilation.
 */
export const artistQuery = (name: string): string => `${name} biography`;

/** {@link artistQuery} for a record. The artist is in it because a title alone does not identify one. */
export const albumQuery = (name: string, artist: string): string => `${artist} ${name} album`;
