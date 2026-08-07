import { Injectable } from 'injectkit';
import { sql } from 'kysely';
import { DataRepository } from '../data/data.repository.js';
import { ArtExtension, isArtExtension } from './art.store.js';

/**
 * A cached (or attempted) piece of art.
 *
 * `checksum` and `ext` travel together: either the fetch produced bytes and both are set, or it did
 * not and neither is. {@link ArtRepository} narrows that pair on the way out so callers do not have
 * to re-check one against the other.
 */
export interface ArtAsset {
    id: string;
    sourceUrl: string;
    /** Absent while the fetch has not produced bytes: a pending row, or one whose attempts failed. */
    checksum?: string;
    ext?: ArtExtension;
    contentType?: string;
    byteSize?: number;
}

/** What the caller hands back after a successful download. */
export interface ArtAssetBytes {
    checksum: string;
    ext: ArtExtension;
    contentType: string;
    byteSize: number;
}

interface ArtAssetRow {
    id: string;
    sourceUrl: string;
    checksum: string | null;
    ext: string | null;
    contentType: string | null;
    byteSize: number | null;
}

const ASSET_COLUMNS = ['id', 'sourceUrl', 'checksum', 'ext', 'contentType', 'byteSize'] as const;

/**
 * Rows read back as `undefined` rather than `null` (see the note in CLAUDE.md), so every optional
 * column is compared with `== null` and dropped rather than passed through. `ext` is validated
 * rather than cast: it is the second half of a filesystem path, and a row edited by hand should
 * read as "no bytes" instead of reaching {@link ArtStore.pathFor} as a surprise.
 */
function toAsset(row: ArtAssetRow): ArtAsset {
    const ext = row.ext == null ? undefined : row.ext;
    const usable = row.checksum != null && isArtExtension(ext);

    return {
        id: row.id,
        sourceUrl: row.sourceUrl,
        ...(usable ? { checksum: row.checksum as string, ext: ext as ArtExtension } : {}),
        ...(row.contentType == null ? {} : { contentType: row.contentType }),
        ...(row.byteSize == null ? {} : { byteSize: row.byteSize }),
    };
}

@Injectable()
export class ArtRepository extends DataRepository {
    /** The asset behind a served URL. */
    async findById(id: string): Promise<ArtAsset | undefined> {
        const row = await this.db.selectFrom('deadair.artAssets').select(ASSET_COLUMNS).where('id', '=', id).executeTakeFirst();

        return row === undefined ? undefined : toAsset(row);
    }

    /** The asset for an upstream URL, cached or merely attempted. */
    async findBySourceUrl(sourceUrl: string): Promise<ArtAsset | undefined> {
        const row = await this.db.selectFrom('deadair.artAssets').select(ASSET_COLUMNS).where('sourceUrl', '=', sourceUrl).executeTakeFirst();

        return row === undefined ? undefined : toAsset(row);
    }

    /**
     * Records bytes against a source URL, creating the row if this is the first attempt.
     *
     * Clears the failure state on the way through: a URL that failed twice and then worked is
     * simply cached, and leaving `last_error` behind would leave the table reading as broken.
     */
    async recordSuccess(sourceUrl: string, bytes: ArtAssetBytes): Promise<ArtAsset> {
        const cached = {
            checksum: bytes.checksum,
            ext: bytes.ext,
            contentType: bytes.contentType,
            byteSize: bytes.byteSize,
            fetchedAt: sql<never>`now()`,
            lastError: null,
            nextAttemptAt: null,
        };

        const row = await this.db
            .insertInto('deadair.artAssets')
            .values({ sourceUrl, ...cached })
            .onConflict(oc => oc.column('sourceUrl').doUpdateSet(cached))
            .returning(ASSET_COLUMNS)
            .executeTakeFirstOrThrow();

        return toAsset(row);
    }

    /**
     * Records that a fetch did not produce bytes, and when it is worth trying again.
     *
     * The row is kept rather than deleted: without it the sweeper cannot tell a URL it has never
     * seen from one that 404s every time, and a dead cover would be re-fetched on every pass
     * forever.
     *
     * The backoff doubles per attempt up to `maxRetryMs`, computed in SQL off the row's own
     * `attempts` so it needs no read first and two concurrent failures cannot both write the same
     * delay from the same stale count.
     */
    async recordFailure(sourceUrl: string, error: string, baseRetryMs: number, maxRetryMs: number): Promise<void> {
        // Cast both bounds: `least()` over two untyped bind parameters resolves to text, and
        // `make_interval(secs => text)` is not a function that exists.
        const baseSecs = sql<number>`${baseRetryMs / 1000}::double precision`;
        const maxSecs = sql<number>`${maxRetryMs / 1000}::double precision`;

        await this.db
            .insertInto('deadair.artAssets')
            .values({
                sourceUrl,
                attempts: 1,
                lastError: error,
                nextAttemptAt: sql<never>`now() + make_interval(secs => least(${baseSecs}, ${maxSecs}))`,
            })
            .onConflict(oc =>
                oc.column('sourceUrl').doUpdateSet(eb => ({
                    attempts: eb('deadair.artAssets.attempts', '+', 1),
                    lastError: error,
                    nextAttemptAt: sql<never>`now() + make_interval(
                        secs => least(${baseSecs} * power(2, deadair.art_assets.attempts), ${maxSecs})
                    )`,
                })),
            )
            .execute();
    }

    /**
     * The next upstream art URLs worth fetching.
     *
     * The queue is the catalog itself rather than a table of its own: `artists.image_url` and
     * `albums.image_url` are written by enrichment and by ingest, neither of which knows this table
     * exists, so anything that promotes an art URL is swept without having to be told. A URL
     * appearing on twenty albums is one row here, because the union is over distinct URLs.
     *
     * Merged rows are excluded for the same reason catalog reads exclude them: nothing will ever
     * render their art. Never-attempted URLs come first, so one permanently dead cover cannot keep
     * a fresh batch from being cached.
     */
    async listPendingSourceUrls(limit: number): Promise<string[]> {
        const rows = await sql<{ url: string }>`
            with candidates as (
                select image_url as url from deadair.artists where image_url is not null and merged_into_id is null
                union
                select image_url as url from deadair.albums where image_url is not null and merged_into_id is null
            )
            select candidates.url
              from candidates
              left join deadair.art_assets on deadair.art_assets.source_url = candidates.url
             where deadair.art_assets.checksum is null
               and (deadair.art_assets.next_attempt_at is null or deadair.art_assets.next_attempt_at <= now())
             order by coalesce(deadair.art_assets.attempts, 0), candidates.url
             limit ${limit}
        `.execute(this.db);

        return rows.rows.map(row => row.url);
    }
}
