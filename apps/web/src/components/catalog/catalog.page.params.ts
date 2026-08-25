import type { CatalogSort, TrackSort } from '@deadair/sdk';

/**
 * Where a catalog list keeps its page, search term and ordering: the URL, not component state.
 *
 * That is what makes a search result linkable and the back button mean what it looks like it
 * means. Every catalog route validates its search params through here so the four lists cannot
 * drift into four spellings of the same values.
 */
export interface CatalogPageParams extends CatalogListOrder {
    /** Zero-based, matching the API. */
    page: number;
    /** Empty means unfiltered. Never undefined, so the components have one shape to handle. */
    search: string;
}

/**
 * How a list is ordered and how much of it is shown.
 *
 * Its own interface because the two detail lists carry it without carrying a search box, and
 * because these three move together: changing any of them is the same gesture as far as the pager
 * is concerned, and all three reset the page to zero.
 */
export interface CatalogOrderParams<TSort extends CatalogSort | TrackSort = CatalogSort | TrackSort> {
    /** A key from the list's own vocabulary. Never empty: a list is always ordered by something. */
    sortBy: TSort;
    sort: 'asc' | 'desc';
    pageSize: number;
}

/** An artist or album list's ordering, and a track list's. Named so a page can say which it holds. */
export type CatalogListOrder = CatalogOrderParams<CatalogSort>;
export type TrackListOrder = CatalogOrderParams<TrackSort>;

/**
 * The states a track list can be narrowed to, matching the API's `TrackState`.
 *
 * Restated here rather than imported from the SDK because this file is what validates a URL, and a
 * hand-typed `?state=nonsense` has to fall back rather than reach the API at all.
 */
export const TRACK_STATES = ['cached', 'uncached', 'unmeasured', 'benched', 'failing'] as const;

export type TrackStateParam = (typeof TRACK_STATES)[number];

/**
 * The two sort vocabularies, matching the API's `CatalogSort` and `TrackSort`.
 *
 * The VALUES are restated for `TRACK_STATES`' reason: this file validates a URL, so a hand-typed key
 * has to fall back before it reaches the API. The TYPE is imported rather than inferred, which is
 * the other half of the same care — a key added to the contract and not to this list is then a
 * compile error here rather than an ordering the console silently cannot offer.
 *
 * The server falls back on a key it cannot serve as well, which is not redundant with this: that
 * one covers a list asked for an ordering it has no column for, and this one covers a word that was
 * never a key at all. Neither is safe to remove because the other exists.
 */
export const CATALOG_SORTS: readonly CatalogSort[] = ['name', 'albums', 'tracks', 'year', 'rating'];

export const TRACK_SORTS: readonly TrackSort[] = ['title', 'artist', 'album', 'year', 'duration', 'rating'];

/**
 * What an operator may set a page to.
 *
 * Three rather than a free number, and the top one is the contract's own ceiling: `Pagination`
 * caps `pageSize` at 100, so a fourth choice above it would be a control that fails validation.
 */
export const PAGE_SIZES = [25, 50, 100] as const;

/**
 * The console's own default, which is not the contract's.
 *
 * The API defaults to 25 because that is a sensible answer for any client. This console draws a
 * dense table on a desk monitor, where 25 rows is half a screen and a pager under it.
 */
export const DEFAULT_PAGE_SIZE = 50;

export interface CatalogTrackParams extends TrackListOrder {
    page: number;
    search: string;
    /** Empty means every record, for the same reason `search` is a string rather than undefined. */
    state: TrackStateParam | '';
}

/** What the routes strip back out of the URL, so a list at rest has no query string at all. */
export const CATALOG_SEARCH_DEFAULTS: CatalogPageParams = { page: 0, search: '', ...orderDefaults('name') };

/** The tracks list carries one more, and strips it the same way. */
export const CATALOG_TRACK_DEFAULTS: CatalogTrackParams = { page: 0, search: '', state: '', ...orderDefaults('title') };

/** One artist's albums, on the artist detail page: ordered like the artists list, with no search box. */
export const CATALOG_ALBUM_DEFAULTS = { page: 0, ...orderDefaults('name') };

/** One album's tracks, on the album detail page: ordered like the tracks list. */
export const CATALOG_ALBUM_TRACK_DEFAULTS = { page: 0, ...orderDefaults('title') };

/** The ordinary opening state of any list: its own first key, ascending, at the console's page size. */
function orderDefaults<T extends CatalogSort | TrackSort>(sortBy: T): CatalogOrderParams<T> {
    return { sortBy, sort: 'asc', pageSize: DEFAULT_PAGE_SIZE };
}

/**
 * Reads the ordering out of whatever is in the URL, against one list's own vocabulary.
 *
 * `asc` rather than the contract's `desc`, and that is the whole reason this defaults anything: a
 * name list opened descending opens at Z, which reads as a broken page rather than as an ordering.
 */
function validateOrder<T extends CatalogSort | TrackSort>(input: Record<string, unknown>, known: readonly T[], fallback: T): CatalogOrderParams<T> {
    const size = Number(input.pageSize);

    return {
        sortBy: known.find(key => key === input.sortBy) ?? fallback,
        sort: input.sort === 'desc' ? 'desc' : 'asc',
        // Only the offered sizes, because this reaches a contract that caps at 100 and a hand-typed
        // `?pageSize=5000` should land on the list rather than on a validation error.
        pageSize: PAGE_SIZES.find(offered => offered === size) ?? DEFAULT_PAGE_SIZE,
    };
}

/** The page number alone, shared by every list here. */
function validatePage(input: Record<string, unknown>): number {
    const page = Number(input.page);
    return Number.isInteger(page) && page >= 0 ? page : 0;
}

/**
 * Reads the params out of whatever is in the URL.
 *
 * Anything unparseable falls back to the first unfiltered page rather than throwing: a hand-typed
 * or truncated link should land on the list, not on an error boundary.
 */
export function validateCatalogSearch(input: Record<string, unknown>): CatalogPageParams {
    return {
        page: validatePage(input),
        search: typeof input.search === 'string' ? input.search : '',
        ...validateOrder(input, CATALOG_SORTS, 'name'),
    };
}

/** {@link validateCatalogSearch} plus the state filter, which the tracks list alone carries. */
export function validateCatalogTracks(input: Record<string, unknown>): CatalogTrackParams {
    const state = TRACK_STATES.find(known => known === input.state);
    return {
        page: validatePage(input),
        search: typeof input.search === 'string' ? input.search : '',
        ...validateOrder(input, TRACK_SORTS, 'title'),
        state: state ?? '',
    };
}

/** One artist's albums: no search box, and the album half of the catalog vocabulary. */
export function validateCatalogAlbums(input: Record<string, unknown>): { page: number } & CatalogListOrder {
    return { page: validatePage(input), ...validateOrder(input, CATALOG_SORTS, 'name') };
}

/** One album's tracks: no search box, and the track vocabulary. */
export function validateCatalogAlbumTracks(input: Record<string, unknown>): { page: number } & TrackListOrder {
    return { page: validatePage(input), ...validateOrder(input, TRACK_SORTS, 'title') };
}
