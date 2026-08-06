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
     * forever. `attempts` drives the backoff the caller computes.
     */
    async recordFailure(sourceUrl: string, error: string, retryInMs: number): Promise<void> {
        const nextAttemptAt = sql<never>`now() + make_interval(secs => ${retryInMs / 1000})`;

        await this.db
            .insertInto('deadair.artAssets')
            .values({ sourceUrl, attempts: 1, lastError: error, nextAttemptAt })
            .onConflict(oc =>
                oc.column('sourceUrl').doUpdateSet(eb => ({
                    attempts: eb('deadair.artAssets.attempts', '+', 1),
                    lastError: error,
                    nextAttemptAt,
                })),
            )
            .execute();
    }
}
