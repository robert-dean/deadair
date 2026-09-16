import { sql } from 'kysely';

/**
 * One art column read as the URL a catalog read reports: the station's own copy when it has one,
 * the upstream URL until then.
 *
 * One field rather than two, because a consumer wanting art has no use for the distinction: it
 * wants a URL that renders. An absolute `https://...` means nothing has cached it yet, and a
 * relative `art/<id>/cover.<ext>` is a path under the API root. The API mounts its routers at the
 * root and knows nothing about the `/api` prefix the edge adds, so it cannot mint an absolute
 * local URL and does not try; the console resolves it against the base it already configures.
 *
 * **The filename on the end is load-bearing for one kind of consumer and decoration for the
 * rest.** A browser asks for whatever an `<img>` points at, but a hardware player handed an
 * artwork URL in the stream's metadata decides whether to ask by looking at the URL: a BluOS
 * player fetches a link ending in `.jpg` and never requests one ending in an id. Measured on an
 * NAD M10 V2, same bytes and same content type at both paths, it made zero requests for the
 * extensionless one. The extension is the store's own record of what the file is, and
 * `ArtService.getArtFile` ignores it and answers from the id, so a stale name cannot serve the
 * wrong bytes. An asset with no recorded extension keeps the bare `art/<id>`, which is honest:
 * there is nothing true to call it.
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
        (select 'art/' || asset.id || case when asset.ext is null then '' else '/cover.' || asset.ext end
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
