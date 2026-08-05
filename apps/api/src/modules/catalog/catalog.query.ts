import { RepositoryPagination } from '../data/repository.types.js';

/**
 * A page of a catalog list: the shared pagination, plus the console's search box.
 *
 * The search is deliberately server-side. Filtering a page client-side would leave `meta.total`
 * describing the unfiltered set, so the pager would offer pages that render empty.
 */
export type CatalogListQuery = RepositoryPagination & {
    search?: string;
};

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
