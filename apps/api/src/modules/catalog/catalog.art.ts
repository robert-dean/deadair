import { sql } from 'kysely';

/**
 * The art URL a catalog read reports: the station's own copy when it has one, the upstream URL
 * until then.
 *
 * One field rather than two, because a consumer wanting art has no use for the distinction: it
 * wants a URL that renders. An absolute `https://...` means nothing has cached it yet, and a
 * relative `art/<id>` is a path under the API root. The API mounts its routers at the root and
 * knows nothing about the `/api` prefix the edge adds, so it cannot mint an absolute local URL and
 * does not try; the console resolves it against the base it already configures.
 *
 * A correlated subquery rather than a join: `art_assets` has at most one row per source URL, and a
 * join would put the burden of a `distinct` on every caller to protect against a table that grows a
 * second one. `checksum is not null` is what separates a cached asset from a recorded failure.
 *
 * Raw SQL because both halves are the same column read two ways, which the query builder cannot
 * express without naming the table twice in the select list.
 *
 * @param column - Fully qualified art column, in database spelling: `deadair.albums.image_url`.
 */
export const artUrl = (column: string) =>
    sql<string | null>`coalesce(
        (select 'art/' || asset.id
           from deadair.art_assets as asset
          where asset.source_url = ${sql.raw(column)}
            and asset.checksum is not null
          limit 1),
        ${sql.raw(column)}
    )`.as('imageUrl');
