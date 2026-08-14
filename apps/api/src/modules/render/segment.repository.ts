import { Injectable } from 'injectkit';
import { Kysely, sql } from 'kysely';
import type { DateTime } from 'luxon';
import { DataRepository, type DB } from '#modules/data/data.repository.js';
import { StationIdentity } from '#modules/shared/station.identity.js';
import { isSegmentExtension, type SegmentExtension } from './segment.store.js';

/**
 * How far along producing a segment is. Mirrors `segments.state`.
 *
 * Only `ready` may go on air. Everything else is a segment the director SKIPS when the cursor
 * reaches it, which is what keeps a slow renderer from ever costing the station silence.
 *
 * There is a state per STAGE, because making a break is two pieces of work with different failure
 * modes and each is its own job: `planned → writing → written → rendering → ready`, with `failed`
 * off the side. What that buys, beyond a console that can tell "waiting on the renderer" from
 * "being written", is a retry that starts where the work stopped — see {@link claimForRender}.
 */
export type SegmentState = 'planned' | 'writing' | 'written' | 'rendering' | 'ready' | 'failed';

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
    /**
     * Which running-order line these words claim will play next.
     *
     * Absent for a break that promised nothing, which is most of them. See the migration for why a
     * forward claim has to be written down rather than re-derived.
     */
    claimsItemId?: string;
    /**
     * When this break is expected to AIR, as epoch millis, for one placed by a rule on the station
     * clock.
     *
     * Written by the planner and read by the writer, because the words are asked for on a later
     * pass than the one that planted the break and nothing recomputes the schedule in between.
     * Absent for a break planted by ordinary spacing, which is not about a time.
     *
     * The projected time rather than the time the operator asked for: a band at half past lands on
     * the first gap at or after it, and what the break says has to describe when it will be spoken
     * rather than when it was due.
     */
    airsAt?: number;
    /**
     * The window these words stay true in, for a break that named a time.
     *
     * Checked at hand-over and the break dropped when it no longer holds, exactly as
     * {@link claimsItemId} is. Both ends together or neither.
     */
    claimsTime?: { from: number; until: number };
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
    /**
     * The words, when whoever is planning it already knows them.
     *
     * Absent is a segment planted before it has been written: the break planner puts a row and its
     * place in the running order down in one cheap write, and a job writes the script behind it.
     * That order is what keeps planting idempotent, since the next pass over the order sees the gap
     * already filled. A row that is still script-less when the renderer reaches it fails with a
     * reason, which is a break the director skips.
     */
    script?: string;
    voice?: string;
    /** What decided the words. See {@link Segment.writer}. */
    writer?: string;
    /** A note for the birth event, when there is one worth keeping. */
    reason?: string;
    /** When a rule on the station clock placed this. See {@link Segment.airsAt}. */
    airsAt?: number;
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
    claimsItemId: string | null;
    airsAt: DateTime | null;
    claimsTimeFrom: DateTime | null;
    claimsTimeUntil: DateTime | null;
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
    'claimsItemId',
    'airsAt',
    'claimsTimeFrom',
    'claimsTimeUntil',
] as const;

/**
 * Epoch millis as something the column will take.
 *
 * Through SQL rather than as a value, which is what every other timestamptz write in this codebase
 * does (`missingAt`, `expiresAt`) and sidesteps the `DateTime`-versus-`Date` question above
 * entirely: Postgres is handed a number and does the conversion itself.
 */
const instant = (millis: number) => sql<never>`to_timestamp(${millis} / 1000.0)`;

/** What the library scan writes, and what the repository recognises as an import. */
export const LIBRARY_SOURCE = 'library';

/**
 * A timestamp column as epoch millis.
 *
 * The generated types call every `timestamptz` a luxon `DateTime` and the pg driver hands back a
 * JS `Date`, which is a mismatch that predates this and is not resolved here. Both are handled
 * rather than one bet on, because picking either alone is a crash or a lie and the codegen mapping
 * is a setting somebody may change.
 */
function millisOf(value: DateTime | null): number | undefined {
    if (value == null) return undefined;
    return value instanceof Date ? value.getTime() : value.toMillis();
}

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
        ...(row.claimsItemId == null ? {} : { claimsItemId: row.claimsItemId }),
        ...(millisOf(row.airsAt) === undefined ? {} : { airsAt: millisOf(row.airsAt)! }),
        ...(millisOf(row.claimsTimeFrom) === undefined || millisOf(row.claimsTimeUntil) === undefined
            ? {}
            : { claimsTime: { from: millisOf(row.claimsTimeFrom)!, until: millisOf(row.claimsTimeUntil)! } }),
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
    /**
     * Injected rather than passed in, unlike `PlayHistoryRepository` and `StationEventsRepository`,
     * which take theirs as arguments.
     *
     * The difference is who the callers are. Those two have one caller each, holding the identity
     * already. This one is written to from nine places across two jobs, a library scan and the
     * console, none of which has any other reason to know what a broadcast is — so asking each of
     * them for it would put the station's identity into nine signatures to reach one column.
     */
    constructor(
        db: Kysely<DB>,
        private readonly identity: StationIdentity,
    ) {
        super(db);
    }

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
     * Born with no audio either way, which is the state the whole render path hangs off: the
     * director skips it, so a row created here costs the station nothing until a renderer finishes
     * with it, and a renderer that never runs costs it nothing either.
     *
     * Born `written` when the words came WITH it and `planned` when they did not, because those are
     * two different requests. `POST /segments` with a script is handing over the words and asking
     * only for audio; the break planner puts down a place in the running order and leaves the words
     * to a job. Starting the first at `planned` would mean the renderer could not claim it, and
     * starting the second anywhere else would mean nothing ever wrote it.
     */
    async plan(planned: PlannedSegment): Promise<Segment> {
        const state: SegmentState = planned.script === undefined ? 'planned' : 'written';

        const row = await this.db
            .insertInto('deadair.segments')
            .values({
                stationKey: this.identity.stationKey,
                kind: planned.kind,
                label: planned.label,
                script: planned.script ?? null,
                voice: planned.voice ?? null,
                writer: planned.writer ?? null,
                airsAt: planned.airsAt === undefined ? null : instant(planned.airsAt),
                source: RENDER_SOURCE,
                state,
            })
            .returning(SEGMENT_COLUMNS)
            .executeTakeFirstOrThrow();

        // No `from`: a row that has just been created came from nowhere, which is what distinguishes
        // the first event of a segment's life from every one after it.
        await this.record(row.id, undefined, state, planned.reason);
        return toSegment(row);
    }

    /**
     * Take a segment for writing, if it is still there to be taken.
     *
     * The same conditional update as {@link claimForRender} and for the same reason, one stage
     * earlier: only one `planned → writing` can win, so a second send of the write job — a duplicate
     * from the director's pass, a retry, a restart — finds nothing to claim and stops. That is what
     * makes sending one free, which in turn is what lets the caller re-offer a break every time it
     * looks rather than having to remember what it already asked for.
     *
     * `planned` only. A break already being written belongs to whoever claimed it; one already
     * written does not need writing again; and a `failed` one is deliberately NOT re-claimable here,
     * unlike a failed render, because the reason it failed is usually that there was nothing true to
     * say about these two records, and that does not change by asking again.
     */
    async claimForWrite(id: string): Promise<Segment | undefined> {
        const claimed = await this.db
            .updateTable('deadair.segments')
            .set({ state: 'writing' })
            .where('id', '=', id)
            .where('state', '=', 'planned')
            .returning(SEGMENT_COLUMNS)
            .executeTakeFirst();

        if (claimed === undefined) return undefined;

        await this.record(id, 'planned', 'writing');
        return toSegment(claimed);
    }

    /**
     * Put the words on a segment that was claimed for writing, and move it on.
     *
     * Guarded on `writing`, which is to say on the claim this caller took: a break whose slot has
     * since been rendered, failed or aired is never rewritten underneath itself, and neither is one
     * some other run claimed in between. The label goes with the script because the two are written
     * together and by the same writer — a break titled for the record it introduces is only correct
     * for the words that introduce it.
     *
     * The state moves in the SAME statement as the words, so there is no instant where a script
     * exists under a state saying it does not.
     *
     * @returns whether this caller still held the claim.
     */
    async writeScript(
        id: string,
        written: { script: string; label: string; writer: string; claimsItemId?: string; claimsTime?: { from: number; until: number } },
    ): Promise<boolean> {
        const result = await this.db
            .updateTable('deadair.segments')
            .set({
                script: written.script,
                label: written.label,
                writer: written.writer,
                state: 'written',
                // Set together with the words, because it describes them: a claim is a statement
                // the script makes, and one outliving a rewrite would be a promise about a
                // sentence that is no longer there. Null clears it for the same reason.
                claimsItemId: written.claimsItemId ?? null,
                // The same argument in the other dimension: a break naming a TIME is overtaken by
                // the clock the way one naming the next record is overtaken by an edit. Written
                // with the words because the window comes from the phrasing, and cleared with them
                // for the same reason.
                claimsTimeFrom: written.claimsTime === undefined ? null : instant(written.claimsTime.from),
                claimsTimeUntil: written.claimsTime === undefined ? null : instant(written.claimsTime.until),
            })
            .where('id', '=', id)
            .where('state', '=', 'writing')
            .executeTakeFirst();

        const wrote = (result.numUpdatedRows ?? 0n) > 0n;
        if (wrote) await this.record(id, 'writing', 'written');

        return wrote;
    }

    /**
     * Un-write the breaks that promised a record which is no longer going to air.
     *
     * A break saying "coming up, X" is a statement about the future baked into audio that cannot be
     * re-cut, and the station already refuses to air one whose promise has stopped being true. This
     * is the half before that: if the promise breaks EARLY enough — a copy benched at the commit
     * pass rather than at the slot — the words can simply be written again, and a break that says
     * something true is worth more than a boundary of silence.
     *
     * Back to `planned` with the script, the label, the writer and both claims cleared, which is
     * precisely the state a freshly planted break is in — so `BreakPlanner.ripen` re-offers it on
     * the next pass and `WriteBreakJob` writes it against the order as it now stands. **Nothing
     * here needs a deadline.** If the rewrite lands before the slot, the break airs with correct
     * words; if it does not, the segment is not `ready` when its turn comes and the director skips
     * it, which is the rule that has always kept a slow writer from costing the station silence.
     *
     * `writing` and `rendering` are deliberately left alone: both are a job's claim, and resetting
     * a row underneath one would have it finish into a state its caller no longer owns. A
     * `rendering` break whose promise broke is still caught at hand-over by the claim check, which
     * is where it would have been caught anyway.
     *
     * @returns the ids actually reopened, which is what an operator is told about.
     */
    async reopenClaims(itemIds: readonly string[]): Promise<string[]> {
        if (itemIds.length === 0) return [];

        const rows = await this.db
            .updateTable('deadair.segments')
            .set({
                state: 'planned',
                script: null,
                writer: null,
                claimsItemId: null,
                claimsTimeFrom: null,
                claimsTimeUntil: null,
            })
            .where('claimsItemId', 'in', [...itemIds])
            .where('state', 'in', ['planned', 'written', 'ready'])
            .returning('id')
            .execute();

        for (const row of rows) await this.record(row.id, 'written', 'planned', 'the record it promised is no longer going to air');
        return rows.map(row => row.id);
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
     * `written` is where an ordinary render starts, and `failed` is deliberately re-claimable: an
     * operator asking again for a segment whose engine was down is asking for exactly that. Note
     * which words a retry then speaks — the ones already on the row. That is the whole point of
     * `written` being its own state: a retry that started at `planned` would pay a writer to invent
     * different words for a break that was already correct, and on a model that is a bill as well as
     * a change nobody asked for.
     *
     * `ready` is not re-claimable, because the audio already exists. Neither are `planned` and
     * `writing`: there is nothing to say yet, and a render that beat the writer to the row is
     * exactly the race this ordering exists to make impossible.
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
               and s.state in ('written', 'failed')
         returning prior.state as from_state,
                   s.id, s.kind, s.state, s.label, s.script, s.source, s.source_path,
                   s.audio_checksum, s.audio_ext, s.duration_ms, s.error, s.voice, s.writer,
                   s.claims_item_id
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
                .values({
                    stationKey: this.identity.stationKey,
                    // Which broadcast this transition happened during, which the segment row itself
                    // cannot say: an ident is a library row that outlives every broadcast it plays
                    // in. Null for a transition outside one — a library scan, or a re-render an
                    // operator asked for while the station was stood down.
                    broadcastId: this.identity.current() ?? null,
                    segmentId,
                    fromState: from ?? null,
                    toState: to,
                    reason: reason ?? null,
                })
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
                stationKey: this.identity.stationKey,
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
