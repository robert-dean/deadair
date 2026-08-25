import type { OrderByModifiers } from 'kysely';
import { RepositoryPagination } from '../data/repository.types.js';

/**
 * A page of a catalog list: the shared pagination, plus the console's search box.
 *
 * The search is deliberately server-side. Filtering a page client-side would leave `meta.total`
 * describing the unfiltered set, so the pager would offer pages that render empty.
 */
export type CatalogListQuery = RepositoryPagination & {
    search?: string;
    sortBy?: string;
};

/**
 * Which column a sort key names, for one list.
 *
 * The map is per list rather than shared, because the same word means a different column on each
 * one and several words mean nothing at all: `year` is a column on an album and on a track and is
 * not a fact about an artist. What every map has in common is the FALLBACK — a key this list cannot
 * answer falls to its own default rather than throwing, because an ordering nobody can serve should
 * be a list that opens in the ordinary order rather than a page that will not open.
 *
 * The keys are the contract's own enums (`CatalogSort`, `TrackSort`), and are spelled here as plain
 * strings deliberately: a repository that imported a generated wire type would be reading the shape
 * of an HTTP request to decide a column name.
 *
 * Two orderings are deliberately absent and are not oversights. **Last played** has no column: it
 * would be a `max(aired_at)` correlated subquery over `deadair.play_history` joined on a nullable
 * `track_id`, plus a decision about where records that have never aired sort, which is a question
 * about programming rather than about a table. **A track's state** is three independent booleans,
 * so there is no order of it an operator would agree with.
 */
export function columnFor<T extends string>(sortBy: string | undefined, columns: Record<string, T>, fallback: T): T {
    if (sortBy === undefined) return fallback;

    // `Object.hasOwn` rather than a lookup and a nullish check: every object answers `constructor`
    // and `toString`, so the plain form puts a function where a column name goes for a caller who
    // asked to sort by either word. The enum should refuse both long before here, and a map
    // consulted as data rather than as an object is what makes that a second lock instead of the
    // only one.
    const column = Object.hasOwn(columns, sortBy) ? columns[sortBy] : undefined;
    return column ?? fallback;
}

/**
 * The direction, with what the station does not know pushed to the end of it.
 *
 * Postgres sorts nulls LAST ascending and FIRST descending, which is consistent and is the wrong
 * half of the deal for a table an operator clicks: several of these columns are null across most of
 * a library that nothing has enriched, so "longest first" opened on a screenful of records with no
 * duration at all, and the one row that actually answered the question was below them. Unknown
 * belongs at the end whichever way the list is pointed, because it is not an answer in either
 * direction.
 *
 * Applied to every sort rather than only the nullable ones. A column that is `not null` today is one
 * migration away from not being, and a rule that holds everywhere is one nobody has to re-derive.
 */
export function directionFor(sort: 'asc' | 'desc'): OrderByModifiers {
    return builder => (sort === 'asc' ? builder.asc().nullsLast() : builder.desc().nullsLast());
}

/**
 * Wraps a user's search term as a `LIKE` containment pattern, with the wildcards escaped.
 *
 * `%` and `_` are wildcards to SQL and ordinary characters in a title — "50%" and "Chapter_1" are
 * real names, and unescaped they would match far more than the operator typed. The backslash is
 * escaped first so it cannot arrive already doubled; it is Postgres's default `LIKE` escape
 * character, so no `ESCAPE` clause is needed.
 */
export function likeContains(search: string): string {
    return `%${search.replace(/[\\%_]/g, character => `\\${character}`)}%`;
}
