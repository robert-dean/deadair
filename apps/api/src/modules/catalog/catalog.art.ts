import { sql } from 'kysely';

/**
 * One art column read as the URL a catalog read reports: the station's own copy when it has one,
 * the upstream URL until then.
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
const cachedOrUpstream = (column: string) => sql<string | null>`coalesce(
        (select 'art/' || asset.id
           from deadair.art_assets as asset
          where asset.source_url = ${sql.raw(column)}
            and asset.checksum is not null
          limit 1),
        ${sql.raw(column)}
    )`;

/**
 * {@link cachedOrUpstream} under the name the contract carries it as.
 *
 * @param alias - The contract field this lands in. `albumImageUrl` on a track, whose art is the
 * record's rather than its own.
 */
export const artUrl = (column: string, alias = 'imageUrl') => cachedOrUpstream(column).as(alias);

/**
 * An artist's art, falling back to the cover of their newest album.
 *
 * Nothing writes `artists.image_url` today: the column is promotable, but the one enrichment
 * source installed here holds no artist images, so the honest state of an artist page is a hole
 * where the picture goes. A record they made is a better answer than a placeholder, and it is one
 * the station already holds the bytes for.
 *
 * Read-time only, and deliberately not promoted onto the row. `promoteArtist` fills that column
 * from a provider that actually resolved an artist image, and a borrowed cover written there would
 * take the gap a real one is waiting for.
 *
 * Newest first because it is the most likely to be the picture an operator has in mind, with the
 * id breaking ties so the choice does not wander between requests.
 */
export const artistArtUrl = () =>
    sql<string | null>`coalesce(
        ${cachedOrUpstream('deadair.artists.image_url')},
        (select ${cachedOrUpstream('deadair.albums.image_url')}
           from deadair.albums
          where deadair.albums.artist_id = deadair.artists.id
            and deadair.albums.merged_into_id is null
            and deadair.albums.image_url is not null
          order by deadair.albums.year desc nulls last, deadair.albums.id asc
          limit 1)
    )`.as('imageUrl');
