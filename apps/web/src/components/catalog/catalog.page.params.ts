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
 * The states a track list can be narrowed to, matching the API's `TrackState`.
 *
 * Restated here rather than imported from the SDK because this file is what validates a URL, and a
 * hand-typed `?state=nonsense` has to fall back rather than reach the API at all.
 */
export const TRACK_STATES = ['cached', 'uncached', 'unmeasured', 'benched', 'failing'] as const;

export type TrackStateParam = (typeof TRACK_STATES)[number];

export interface CatalogTrackParams extends CatalogPageParams {
    /** Empty means every record, for the same reason `search` is a string rather than undefined. */
    state: TrackStateParam | '';
}

/** What the routes strip back out of the URL, so a list at rest has no query string at all. */
export const CATALOG_SEARCH_DEFAULTS: CatalogPageParams = { page: 0, search: '' };

/** The tracks list carries one more, and strips it the same way. */
export const CATALOG_TRACK_DEFAULTS: CatalogTrackParams = { page: 0, search: '', state: '' };

/** The same, for the detail routes, whose lists are one artist's albums or one album's tracks and carry no search box. */
export const CATALOG_PAGE_DEFAULTS = { page: 0 };

/** {@link validateCatalogSearch} without the search term. */
export function validateCatalogPage(input: Record<string, unknown>): { page: number } {
    return { page: validateCatalogSearch(input).page };
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

/** {@link validateCatalogSearch} plus the state filter, which the tracks list alone carries. */
export function validateCatalogTracks(input: Record<string, unknown>): CatalogTrackParams {
    const state = TRACK_STATES.find(known => known === input.state);
    return { ...validateCatalogSearch(input), state: state ?? '' };
}
