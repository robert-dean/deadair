/**
 * The `search` kind. A search plugin answers an OPEN question by asking a search
 * engine, and hands back what the engine said.
 *
 * ## This is the open web, not the library
 *
 * Nothing here is about records. Looking for something to play is
 * `music.provider.searchTracks`, which answers with tracks that carry provider
 * ids the pick path can resolve; every result here is a page, and a page cannot
 * be scheduled. The two are different questions with different answers, and the
 * host keeps them apart so a model steered by one is never handed the other.
 *
 * ## Why this is not `news`
 *
 * A news plugin serves a MENU an operator assembled: feeds somebody chose, with
 * ids, categories and a de-duplication contract, answering "what happened". This
 * answers "what does the web say about X" — the caller supplies the subject, the
 * plugin has no idea what will come back, and there is nothing stable to
 * de-duplicate against because no two calls ask the same question.
 *
 * ## It reports what the engine said, and it does not summarise
 *
 * A {@link SearchResult.snippet} is the engine's own text, trimmed of markup and
 * otherwise untouched. Several engines will also sell a synthesized ANSWER —
 * Tavily's `answer`, SearXNG's infobox — and this capability deliberately has
 * nowhere to put one. That paragraph is somebody else's model paraphrasing pages
 * this station never sees, so nothing can check it against a source, and a claim
 * that cannot be checked is one the station must not broadcast. The same
 * boundary `capabilities/enrichment.ts` keeps with `SourceDocument`: a plugin
 * fetches and the host thinks.
 *
 * A plugin that wants to contribute PROSE the host can extract claims from
 * declares `enrichment` as well and returns documents there, where the fact
 * store's provenance and quote checking already live.
 *
 * ## Nothing here airs
 *
 * A result is words on a page. Whether any of it is spoken is settled by a break
 * writer on a station that is on air, and this capability has no way to reach one.
 *
 * Every shape here is JSON-safe.
 */

/**
 * How fresh a result has to be.
 *
 * Coarse on purpose, because that is how every engine models it: Brave takes
 * `pd|pw|pm|py`, SearXNG takes `day|week|month|year`, and an exact window is not
 * on offer anywhere. A plugin whose engine cannot filter by age ignores it
 * rather than filtering the page itself, since a result's date is frequently the
 * one field an engine gets wrong.
 */
export type SearchRecency = 'day' | 'week' | 'month' | 'year';

/** What a search source is asked. */
export interface SearchQuery {
    /** The words to search for, as somebody would type them. */
    query: string;
    /** How many results to return. A plugin may return fewer; it must not return more. */
    limit: number;
    /** Only results this recent, when the engine can say. Absent for anything, whatever its age. */
    recency?: SearchRecency;
    /** ISO 639-1, when the caller has an opinion about what language the answer should be in. */
    language?: string;
}

/** One hit. */
export interface SearchResult {
    /** The page's title, as the engine gave it. */
    title: string;
    /**
     * The engine's own extract, as PLAIN TEXT.
     *
     * Never markup. Search APIs are the worst offenders here: Brave highlights
     * query terms with `<strong>` unless told not to, and descriptions carry
     * HTML entities either way. Both end up in a model's context and possibly in
     * a speaking voice, so `html.text.ts` is what a plugin runs them through.
     */
    snippet: string;
    /** Where the page is. Kept so a caller can cite it, read it, or check it against an allowlist. */
    url: string;
    /**
     * Who published it, in the fewest words a presenter could say out loud.
     *
     * The engine's own profile name where it has one, and the hostname
     * otherwise. It exists because attribution is the only part of a result a
     * station can broadcast: a URL read aloud is the least useful sentence radio
     * has ever carried, and "according to the Guardian" is a real one.
     */
    site?: string;
    /** ISO-8601. Never a `Date`, and absent whenever the engine did not say — which is most results. */
    publishedAt?: string;
}

/**
 * Implemented by a `search` plugin.
 */
export interface SearchProvider {
    /**
     * Run the query, best first.
     *
     * An empty array is an ordinary answer and not a failure: an unconfigured
     * plugin, an engine that is down, a rate limit and a query nothing matches
     * are one outcome to every caller, and the difference belongs in the
     * plugin's own log. Throw only for something the operator has to fix, since
     * the host turns a throw into a line an operator reads.
     */
    search(query: SearchQuery): Promise<SearchResult[]>;
}
