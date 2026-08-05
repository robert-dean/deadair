/**
 * Where a catalog list keeps its page and search term: the URL, not component state.
 *
 * That is what makes a search result linkable and the back button mean what it looks like it
 * means. Every catalog route validates its search params through here so the three lists cannot
 * drift into three spellings of the same two values.
 */
export interface CatalogPageParams {
    /** Zero-based, matching the API. */
    page: number;
    /** Empty means unfiltered. Never undefined, so the components have one shape to handle. */
    search: string;
}

/**
 * Reads the two params out of whatever is in the URL.
 *
 * Anything unparseable falls back to the first unfiltered page rather than throwing: a hand-typed
 * or truncated link should land on the list, not on an error boundary.
 */
export function validateCatalogSearch(input: Record<string, unknown>): CatalogPageParams {
    const page = Number(input.page);
    return {
        page: Number.isInteger(page) && page >= 0 ? page : 0,
        search: typeof input.search === 'string' ? input.search : '',
    };
}
