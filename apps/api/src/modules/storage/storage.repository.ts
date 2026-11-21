import { Injectable } from 'injectkit';
import { DataRepository } from '#modules/data/data.repository.js';

/**
 * What one table claims about the bytes it points at.
 *
 * `bytes` is optional rather than zero, and the distinction is the whole reason this shape exists:
 * `segments` records which file each break's audio is in and has never recorded how big it is, so a
 * zero there would be a lie about the store rather than a fact about it. A reader shows a dash.
 */
export interface StoredClaims {
    /** Rows pointing at a file. */
    rows: number;
    /** What those rows say those files weigh, where the table records it at all. */
    bytes?: number;
    /** Every file name the table claims, as `<checksum>.<ext>`, for finding what nothing claims. */
    names: Set<string>;
}

/** How a file is keyed across the report, so a row and a directory entry can be compared at all. */
export const fileName = (checksum: string, ext: string): string => `${checksum}.${ext}`;

const empty = (): StoredClaims => ({ rows: 0, bytes: 0, names: new Set() });

/**
 * What the database believes is on disk.
 *
 * One repository over four tables rather than a method added to each table's own, because the
 * question is not any of theirs: `track_audio`, `art_assets`, `segments` and `pads` each know about
 * their own subject and none of them knows what a VOLUME holds. This is the reader that asks all of them the
 * same question so a report can put their answers beside the directories they describe.
 *
 * Every read here is the same shape — rows that point at a file, and the names they point at — and
 * every one of them excludes rows that do not, because a remembered failure is not a claim on disk.
 */
@Injectable()
export class StorageRepository extends DataRepository {
    /** The station's own copies of records, per binding. */
    async trackClaims(): Promise<StoredClaims> {
        const rows = await this.db
            .selectFrom('deadair.trackAudio')
            .select(['checksum', 'ext', 'byteSize'])
            .where('checksum', 'is not', null)
            .execute();

        return rows.reduce((claims, row) => {
            if (row.checksum == null || row.ext == null) return claims;
            claims.rows += 1;
            claims.bytes = (claims.bytes ?? 0) + Number(row.byteSize ?? 0);
            claims.names.add(fileName(row.checksum, row.ext));
            return claims;
        }, empty());
    }

    /** Cover art, per source URL. */
    async artClaims(): Promise<StoredClaims> {
        const rows = await this.db
            .selectFrom('deadair.artAssets')
            .select(['checksum', 'ext', 'byteSize'])
            .where('checksum', 'is not', null)
            .execute();

        return rows.reduce((claims, row) => {
            if (row.checksum == null || row.ext == null) return claims;
            claims.rows += 1;
            claims.bytes = (claims.bytes ?? 0) + Number(row.byteSize ?? 0);
            claims.names.add(fileName(row.checksum, row.ext));
            return claims;
        }, empty());
    }

    /**
     * Everything in the segment store: spoken segments per segment row, and the soundboard per pad.
     *
     * Pads are here because they are in the same directory. `PadLibrary.ingest` writes every pad's
     * bytes through `SegmentStore.write`, and `deadair.pads` is the only row that names them, so a
     * reading of this store that asked `segments` alone saw the whole rack as orphaned and the nightly
     * sweep deleted it once the grace period passed. A pad's signed URL then answered 404, and every
     * break that hit one fell back to its words alone.
     *
     * One answer for the store rather than a second entry beside it, because the report and the sweep
     * are both keyed by DIRECTORY: a separate pads entry would walk the same files again and count
     * every segment in it as a pad nobody claims. So `rows` is every row in either table that points
     * at a file here, and `rowsWithNoFile` covers a pad whose bytes have gone as well as a segment's.
     *
     * Every pad counts whatever its state: a rejected pad is off the rack, and its bytes are still the
     * row's to clear, as a `failed` segment keeps its old audio.
     *
     * No byte size, because neither table holds one: `segments` holds a duration, which is what airing
     * a break needs, and `pads` the same. So this answers rows and names and leaves `bytes` absent
     * rather than inventing a total nothing measured.
     *
     * The same file legitimately belongs to several rows: an ident is one recording that sits at
     * three slots in an hour, identical spoken words hash to one file, and a pad dropped into two
     * boards is one file under two rows. `names` is a set for that reason, and `rows` is deliberately
     * the row count rather than the file count: they answer different questions and a report shows
     * both.
     */
    async segmentClaims(): Promise<StoredClaims> {
        const [segments, pads] = await Promise.all([
            this.db.selectFrom('deadair.segments').select(['audioChecksum', 'audioExt']).where('audioChecksum', 'is not', null).execute(),
            this.db.selectFrom('deadair.pads').select(['audioChecksum', 'audioExt']).execute(),
        ]);

        return [...segments, ...pads].reduce<StoredClaims>(
            (claims, row) => {
                if (row.audioChecksum == null || row.audioExt == null) return claims;
                claims.rows += 1;
                claims.names.add(fileName(row.audioChecksum, row.audioExt));
                return claims;
            },
            { rows: 0, names: new Set() },
        );
    }
}
