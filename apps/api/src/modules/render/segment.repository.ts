import { Injectable } from 'injectkit';
import { DataRepository } from '#modules/data/data.repository.js';
import { isSegmentExtension, type SegmentExtension } from './segment.store.js';

/**
 * How far along producing a segment is. Mirrors `segments.state`.
 *
 * Only `ready` may go on air. Everything else is a segment the director SKIPS when the cursor
 * reaches it, which is what keeps a slow renderer from ever costing the station silence.
 */
export type SegmentState = 'planned' | 'rendering' | 'ready' | 'failed';

/**
 * One thing the station can play that is not a record.
 *
 * `audioChecksum` and `audioExt` travel together, the way `ArtAsset`'s do: either there is audio
 * and both are set, or there is not and neither is. The repository narrows that pair on the way
 * out, so a caller never has to re-check one against the other before reaching the store.
 */
export interface Segment {
    id: string;
    kind: string;
    state: SegmentState;
    label: string;
    script?: string;
    source: string;
    sourcePath?: string;
    audioChecksum?: string;
    audioExt?: SegmentExtension;
    durationMs?: number;
    error?: string;
}

/** A segment as it is created from an imported file: audio first, everything else described. */
export interface ImportedSegment {
    kind: string;
    label: string;
    sourcePath: string;
    audioChecksum: string;
    audioExt: SegmentExtension;
    durationMs?: number;
}

interface SegmentRow {
    id: string;
    kind: string;
    state: SegmentState;
    label: string;
    script: string | null;
    source: string;
    sourcePath: string | null;
    audioChecksum: string | null;
    audioExt: string | null;
    durationMs: number | null;
    error: string | null;
}

const SEGMENT_COLUMNS = [
    'id',
    'kind',
    'state',
    'label',
    'script',
    'source',
    'sourcePath',
    'audioChecksum',
    'audioExt',
    'durationMs',
    'error',
] as const;

/** What the library scan writes, and what the repository recognises as an import. */
export const LIBRARY_SOURCE = 'library';

/**
 * Rows read back as `undefined` rather than `null` (see the note in CLAUDE.md), so every optional
 * column is compared with `== null` and dropped rather than passed through. `audioExt` is
 * validated rather than cast: it is the second half of a filesystem path, and a row edited by hand
 * should read as "no audio" instead of reaching {@link SegmentStore.pathFor} as a surprise.
 */
function toSegment(row: SegmentRow): Segment {
    const ext = row.audioExt == null ? undefined : row.audioExt;
    const playable = row.audioChecksum != null && isSegmentExtension(ext);

    return {
        id: row.id,
        kind: row.kind,
        state: row.state,
        label: row.label,
        source: row.source,
        ...(playable ? { audioChecksum: row.audioChecksum as string, audioExt: ext as SegmentExtension } : {}),
        ...(row.script == null ? {} : { script: row.script }),
        ...(row.sourcePath == null ? {} : { sourcePath: row.sourcePath }),
        ...(row.durationMs == null ? {} : { durationMs: row.durationMs }),
        ...(row.error == null ? {} : { error: row.error }),
    };
}

@Injectable()
export class SegmentRepository extends DataRepository {
    /** One segment, whatever state it is in. */
    async findById(id: string): Promise<Segment | undefined> {
        const row = await this.db.selectFrom('deadair.segments').select(SEGMENT_COLUMNS).where('id', '=', id).executeTakeFirst();

        return row === undefined ? undefined : toSegment(row);
    }

    /** The whole library, newest first, for a console that has to draw it. */
    async list(): Promise<Segment[]> {
        const rows = await this.db.selectFrom('deadair.segments').select(SEGMENT_COLUMNS).orderBy('createdAt', 'desc').execute();

        return rows.map(toSegment);
    }

    /**
     * Take an imported file into the library, or answer with the segment that already holds those
     * bytes.
     *
     * Content-addressed and therefore idempotent: scanning the inbox twice, or dropping the same
     * recording in under a second name, is one segment either way.
     *
     * The read comes first and answers on its own, so the ordinary case — a boot scan over an inbox
     * nothing has changed — is one SELECT per file and no write at all. Without it the insert would
     * conflict into an UPDATE and bump `updated_at` on every segment the station owns on every
     * restart, which would leave that column meaning "when the API last booted" rather than when
     * anything about the segment changed.
     *
     * The conflict clause behind it is for the race the read cannot close: two scans arriving
     * together, both finding nothing. Its target is the partial unique index on
     * `(audio_checksum) where source = 'library'`, and the predicate has to be spelled out for
     * Postgres to infer that index. `doUpdateSet` rather than `doNothing` because `doNothing`
     * returns no row and this has to answer with the segment either way; nothing about it actually
     * changes.
     */
    async importFile(imported: ImportedSegment): Promise<{ segment: Segment; created: boolean }> {
        const existing = await this.db
            .selectFrom('deadair.segments')
            .select(SEGMENT_COLUMNS)
            .where('audioChecksum', '=', imported.audioChecksum)
            .where('source', '=', LIBRARY_SOURCE)
            .executeTakeFirst();

        if (existing !== undefined) return { segment: toSegment(existing), created: false };

        const row = await this.db
            .insertInto('deadair.segments')
            .values({
                kind: imported.kind,
                label: imported.label,
                source: LIBRARY_SOURCE,
                sourcePath: imported.sourcePath,
                audioChecksum: imported.audioChecksum,
                audioExt: imported.audioExt,
                durationMs: imported.durationMs ?? null,
                // An imported file is audio first and foremost: there is nothing left to produce,
                // so it is born on air rather than planned.
                state: 'ready',
            })
            .onConflict(oc =>
                oc
                    .column('audioChecksum')
                    .where('source', '=', LIBRARY_SOURCE)
                    .where('audioChecksum', 'is not', null)
                    .doUpdateSet({ audioChecksum: imported.audioChecksum }),
            )
            .returning(SEGMENT_COLUMNS)
            .executeTakeFirstOrThrow();

        // `true` even in the conflict case, where this lost the race and is looking at the row the
        // other scan wrote. The returned row is the existing one and nothing distinguishes it from
        // a fresh insert without reading `xmax`, which is a lot of obscurity to buy accuracy in a
        // counter that appears in one log line and one scan result. Two concurrent scans of the
        // same inbox is not a state the station ends up in by itself.
        return { segment: toSegment(row), created: true };
    }
}
