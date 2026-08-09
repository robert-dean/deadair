import { Injectable } from 'injectkit';
import { sql } from 'kysely';
import type { DateTime } from 'luxon';
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
    /**
     * The station's own name for the voice this should be said in, not any engine's. Absent means
     * whatever the speech plugin's default is, which is the ordinary case.
     */
    voice?: string;
    /**
     * What decided the words: `deterministic` for the station's own templates, later the id of the
     * plugin whose model wrote them. Absent for an imported recording and for a segment nothing has
     * written yet.
     */
    writer?: string;
}

/**
 * One thing that happened to a segment.
 *
 * The log behind `segments.state`, which only ever says where a segment is NOW. Read newest-first
 * by anything asking why a break did not air.
 */
export interface SegmentEvent {
    id: string;
    segmentId: string;
    at: DateTime;
    /** Where it came from. Absent on the first event of a row, which came from nowhere. */
    fromState?: SegmentState;
    toState: SegmentState;
    /** Why, when there is a sentence worth keeping. */
    reason?: string;
}

/** A segment the station means to say, before anything has said it. */
export interface PlannedSegment {
    kind: string;
    label: string;
    script: string;
    voice?: string;
    /** What decided the words. See {@link Segment.writer}. */
    writer?: string;
    /** A note for the birth event, when there is one worth keeping. */
    reason?: string;
}

/** What the renderer writes back when it worked. */
export interface RenderedAudio {
    audioChecksum: string;
    audioExt: SegmentExtension;
    durationMs?: number;
}

/** What the station wrote itself, as opposed to `library` for a file somebody dropped in. */
export const RENDER_SOURCE = 'render';

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
    voice: string | null;
    writer: string | null;
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
    'voice',
    'writer',
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
        ...(row.voice == null ? {} : { voice: row.voice }),
        ...(row.writer == null ? {} : { writer: row.writer }),
    };
}

/**
 * Why the event log is written as a second statement rather than atomically with the change it
 * describes.
 *
 * A `segment_events` row is a LOG and not a ledger: nothing reads it to decide anything, and every
 * answer it holds is also derivable from the segment row itself while that row is current. So the
 * worst a lost event can do is leave a gap in the console's activity feed, which is a cosmetic fault
 * on a station that is still airing the right audio. Buying atomicity would mean a data-modifying
 * CTE around every write here, which is a shape the next person to add a column cannot safely edit,
 * and it would buy it against a window of microseconds in which the process has to die.
 *
 * The one place that is NOT true is {@link SegmentRepository.claimForRender}, where the state being
 * moved FROM is only knowable inside the statement that moves it. That one reads the prior row in
 * the same update rather than guessing.
 */
@Injectable()
export class SegmentRepository extends DataRepository {
    /** One segment, whatever state it is in. */
    async findById(id: string): Promise<Segment | undefined> {
        const row = await this.db.selectFrom('deadair.segments').select(SEGMENT_COLUMNS).where('id', '=', id).executeTakeFirst();

        return row === undefined ? undefined : toSegment(row);
    }

    /**
     * Several segments at once, keyed by id.
     *
     * What the director commits against and what the console draws a lineup with. One query rather
     * than one per line, because both callers hold a list and the alternative is an N+1 on the
     * track boundary. Ids it does not have are simply absent from the map, which is the same answer
     * as a segment that cannot air.
     */
    async findByIds(ids: readonly string[]): Promise<Map<string, Segment>> {
        if (ids.length === 0) return new Map();

        const rows = await this.db
            .selectFrom('deadair.segments')
            .select(SEGMENT_COLUMNS)
            .where('id', 'in', [...ids])
            .execute();

        return new Map(rows.map(row => [row.id, toSegment(row)]));
    }

    /**
     * Everything of one kind that can actually go on air.
     *
     * What the planner chooses from. `ready` is applied in SQL rather than filtered afterwards
     * because it is what the partial index is built on, and because a station whose library is
     * mostly half-rendered talk breaks should not drag them all across the wire to throw them away.
     */
    async listReady(kind: string): Promise<Segment[]> {
        const rows = await this.db
            .selectFrom('deadair.segments')
            .select(SEGMENT_COLUMNS)
            .where('kind', '=', kind)
            .where('state', '=', 'ready')
            .orderBy('createdAt', 'asc')
            .execute();

        return rows.map(toSegment);
    }

    /**
     * The last few things the station said of one kind, newest first.
     *
     * What a writer reads to avoid repeating itself. Deliberately every state rather than only
     * `ready`: a break the station wrote and then failed to speak was still written, and offering it
     * again as though it were fresh is how a phrasing that never aired blocks nothing while one that
     * did blocks everything.
     *
     * This is the cheap seed of "what the station said", and it stops being enough the moment a
     * persona is involved: a character sheet asking for a signature phrase now and then is an
     * instruction no writer can follow from scripts alone. That wants its own table rather than a
     * relaxation of `play_history`; see `docs/todo/dj-voice.md`.
     */
    async recentScripts(kind: string, limit: number): Promise<string[]> {
        if (limit <= 0) return [];

        const rows = await this.db
            .selectFrom('deadair.segments')
            .select('script')
            .where('kind', '=', kind)
            .where('script', 'is not', null)
            .orderBy('createdAt', 'desc')
            .limit(limit)
            .execute();

        return rows.flatMap(row => (row.script == null ? [] : [row.script]));
    }

    /** The whole library, newest first, for a console that has to draw it. */
    async list(): Promise<Segment[]> {
        const rows = await this.db.selectFrom('deadair.segments').select(SEGMENT_COLUMNS).orderBy('createdAt', 'desc').execute();

        return rows.map(toSegment);
    }

    /**
     * Write down something the station means to say, before anything has said it.
     *
     * Born `planned` with no audio, which is the state the whole render path hangs off: the
     * director skips it, so a row created here costs the station nothing until a renderer finishes
     * with it, and a renderer that never runs costs it nothing either.
     */
    async plan(planned: PlannedSegment): Promise<Segment> {
        const row = await this.db
            .insertInto('deadair.segments')
            .values({
                kind: planned.kind,
                label: planned.label,
                script: planned.script,
                voice: planned.voice ?? null,
                writer: planned.writer ?? null,
                source: RENDER_SOURCE,
                state: 'planned',
            })
            .returning(SEGMENT_COLUMNS)
            .executeTakeFirstOrThrow();

        // No `from`: a row that has just been created came from nowhere, which is what distinguishes
        // the first event of a segment's life from every one after it.
        await this.record(row.id, undefined, 'planned', planned.reason);
        return toSegment(row);
    }

    /**
     * Take a segment for rendering, if it is still there to be taken.
     *
     * A conditional update rather than a read followed by a write, so two runs of the job cannot
     * both decide to render the same row: only one `planned → rendering` can win, and the loser
     * gets `undefined` and stops. That matters because the job has one retry, and a retry arriving
     * while the first attempt is still speaking would otherwise pay a second time for the same
     * audio and race to write the same row.
     *
     * `failed` is deliberately re-claimable: an operator asking again for a segment whose engine
     * was down is asking for exactly that. `ready` is not, because the audio already exists.
     */
    async claimForRender(id: string): Promise<Segment | undefined> {
        // Raw, and joined against the table's own pre-update snapshot, for one reason: `returning`
        // answers with the row as it now IS, and the event wants the state it came FROM. A read
        // before the write would give that and would also give up the atomicity this method exists
        // for. The `from deadair.segments as prior` join is the standard way to have both: the join
        // sees the row as it stood when the statement began.
        const claimed = await sql<SegmentRow & { fromState: SegmentState }>`
            update deadair.segments as s
               set state = 'rendering', error = null
              from deadair.segments as prior
             where s.id = prior.id
               and s.id = ${id}::uuid
               and s.state in ('planned', 'failed')
         returning prior.state as from_state,
                   s.id, s.kind, s.state, s.label, s.script, s.source, s.source_path,
                   s.audio_checksum, s.audio_ext, s.duration_ms, s.error, s.voice, s.writer
        `.execute(this.db);

        const row = claimed.rows[0];
        if (row === undefined) return undefined;

        await this.record(row.id, row.fromState, 'rendering');
        return toSegment(row);
    }

    /**
     * The audio arrived: the segment can go on air.
     *
     * Clears `error`, so a segment that failed once and then worked does not keep advertising the
     * reason it used to fail.
     */
    async markReady(id: string, audio: RenderedAudio): Promise<void> {
        await this.db
            .updateTable('deadair.segments')
            .set({
                state: 'ready',
                audioChecksum: audio.audioChecksum,
                audioExt: audio.audioExt,
                durationMs: audio.durationMs ?? null,
                error: null,
            })
            .where('id', '=', id)
            .execute();

        await this.record(id, 'rendering', 'ready');
    }

    /**
     * It did not work, and this is why.
     *
     * The audio columns are left exactly as they were rather than cleared. A segment that was
     * `ready` and then failed a re-render still has its old audio, and keeping it is the difference
     * between the station saying something slightly stale and the station saying nothing.
     */
    async markFailed(id: string, error: string, from?: SegmentState): Promise<void> {
        await this.db.updateTable('deadair.segments').set({ state: 'failed', error }).where('id', '=', id).execute();

        // `from` is optional because failing is the one transition that can arrive from anywhere: a
        // render dies out of `rendering`, a break nothing could write dies out of `planned`. Absent
        // rather than guessed, since the event before it already says where the segment was.
        await this.record(id, from, 'failed', error);
    }

    /**
     * What has happened to one segment, oldest first.
     *
     * The whole story rather than a page of it: a segment accumulates one event per state change,
     * so even a break that failed and was re-rendered a dozen times is a few dozen rows.
     */
    async events(segmentId: string): Promise<SegmentEvent[]> {
        const rows = await this.db
            .selectFrom('deadair.segmentEvents')
            .select(['id', 'segmentId', 'createdAt', 'fromState', 'toState', 'reason'])
            .where('segmentId', '=', segmentId)
            .orderBy('createdAt', 'asc')
            .execute();

        return rows.map(row => ({
            id: row.id,
            segmentId: row.segmentId,
            at: row.createdAt,
            toState: row.toState,
            ...(row.fromState == null ? {} : { fromState: row.fromState as SegmentState }),
            ...(row.reason == null ? {} : { reason: row.reason }),
        }));
    }

    /**
     * Write down that a segment moved, and why.
     *
     * Never throws into its caller. A state change that happened is a fact whether or not the note
     * about it landed, and a segment left `rendering` forever because its log line failed would be
     * the log costing the station the very thing it exists to explain.
     */
    private async record(segmentId: string, from: SegmentState | undefined, to: SegmentState, reason?: string): Promise<void> {
        try {
            await this.db
                .insertInto('deadair.segmentEvents')
                .values({ segmentId, fromState: from ?? null, toState: to, reason: reason ?? null })
                .execute();
        } catch {
            // Deliberately silent, and deliberately not the app logger: this is reached from a job
            // that is already logging the transition itself, so a failure here is visible as an
            // event the feed does not have rather than as a line nobody reads.
        }
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
