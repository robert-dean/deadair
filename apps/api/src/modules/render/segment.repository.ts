import { Injectable } from 'injectkit';
import { expressionBuilder, Kysely, sql, type Expression, type SqlBool } from 'kysely';
import type { DateTime } from 'luxon';
import { DataRepository, type DB } from '#modules/data/data.repository.js';
import { StationIdentity } from '#modules/shared/station.identity.js';
import type { BreakContext } from '#modules/director/break.request.js';
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
 * One pad a script hits, as the row remembers it.
 *
 * Both halves are load-bearing and neither can be dropped for the other. The `name` is what the
 * script actually carries, so the render path can find WHERE in the words it happens. The `padId` is
 * what the writer resolved that name to against the board in force at the time, so what gets joined
 * is the sound the words were written for even if the character has been recast since.
 */
export interface PadHit {
    name: string;
    padId: string;
}

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
    /**
     * The words as the engine was handed them, once something has spoken this.
     *
     * Not the script and not a tidier version of it: `transposeForSpeech` says the symbols, reads
     * the years as a person reads them and applies the operator's own pronunciations, all on the way
     * INTO the engine. It is kept because that list can change between two renders of one script, so
     * this is the only thing that answers "why did it say that" about the audio this row actually
     * holds. Absent until a render has happened, and absent for an imported recording.
     */
    spokenScript?: string;
    source: string;
    sourcePath?: string;
    audioChecksum?: string;
    audioExt?: SegmentExtension;
    durationMs?: number;
    /**
     * How loud it came out, in LUFS, once something measured it.
     *
     * Absent until the measurement lands, and absent for good on a station with no analyzer — which
     * is an ordinary state rather than a fault, exactly as it is for a record. What reads it is
     * `speechGainFor`, which falls back to an assumed speech level, so the only cost of absence is
     * a break a decibel or two off rather than a break at the wrong level entirely.
     */
    loudnessLufs?: number;
    error?: string;
    /**
     * The station's own name for the voice this should be said in, not any engine's. Absent means
     * whatever the speech plugin's default is, which is the ordinary case.
     */
    voice?: string;
    /**
     * The production this is a beat of, and where it comes in it.
     *
     * Read together or not at all: the table constrains them to be both set or both null, because a
     * beat with no place in its own programme is not a beat.
     */
    productionId?: string;
    productionOrdinal?: number;
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
     * The soundboard pads this break's script hits, resolved when the words were written.
     *
     * Empty for the ordinary break, which is nearly all of them. Resolved at WRITE time rather than
     * re-derived here, because a pad name is unique per BOARD and only the writer was holding the
     * presenting character's board — see the column comment in migration 0008. A renderer resolving
     * `[sfx:airhorn]` for itself would have to ask who is presenting NOW, and after a recast that is
     * somebody else with a different rack.
     */
    pads: PadHit[];
    /**
     * When this break is expected to AIR, as epoch millis, for one placed by a rule on the station
     * clock.
     *
     * Written by the planner and read by the writer, because the words are asked for on a later pass
     * than the one that planted the break. Absent for a break the order cannot place on the clock,
     * which the writer answers by saying nothing about the time.
     *
     * The projected time rather than the time the operator asked for: a band at half past lands on
     * the first gap at or after it, and what the break says has to describe when it will be spoken
     * rather than when it was due.
     *
     * **It is a projection, so it is kept up to date** — see {@link SegmentRepository.reprojectAirTimes},
     * which moves it on every boundary. This note used to end "and nothing recomputes the schedule in
     * between", stated as a property of the design; it was the bug, and it cost the station 76 breaks
     * in a week.
     */
    airsAt?: number;
    /**
     * The window these words stay true in, for a break that named a time.
     *
     * Checked at hand-over and the break dropped when it no longer holds, exactly as
     * {@link claimsItemId} is. Both ends together or neither.
     */
    claimsTime?: { from: number; until: number };
    /**
     * When what this break REPORTED stops being true, for one that reported a measurement.
     *
     * The third dimension beside {@link claimsItemId} and {@link claimsTime}, checked the same way
     * and at the same two moments. One end rather than two, because an observation has no
     * not-true-yet: it was measured, and then it ages. See `segments.claims_reading_until`.
     *
     * Absent for every break that reported nothing, which is nearly all of them.
     */
    claimsReadingUntil?: number;
    /**
     * The request this break was made for, when something asked for it.
     *
     * Absent for a break the station planted for itself, which is most of them: the spacing rules
     * are a function of the running order and need nothing written down. A request is the opposite —
     * it exists because something happened outside the order — and this is how a break gets back to
     * the reason it exists, which is what the writer for its kind is given.
     */
    requestId?: string;
    /**
     * What this break is about, for one the station planted for itself.
     *
     * The other half of the answer a request's own context gives: a band on the format clock can ask
     * for a bulletin about a category, and that has to reach the job that writes the words several
     * passes later. Absent for most breaks, which are about whatever they find.
     */
    context?: BreakContext;
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
    /**
     * The soundboard pads these words hit, already resolved against a board.
     *
     * Only ever set where {@link PlannedSegment.script} is: a row planted before it has been written
     * has no words for a hit to sit in. A production beat is the one caller that needs this on
     * `plan` rather than on {@link SegmentRepository.writeScript}, because a beat's words are known
     * when its row is created — a break's are not, which is why the break path resolves its hits one
     * step later.
     */
    pads?: readonly PadHit[];
    /** What decided the words. See {@link Segment.writer}. */
    writer?: string;
    /** A note for the birth event, when there is one worth keeping. */
    reason?: string;
    /** When a rule on the station clock placed this. See {@link Segment.airsAt}. */
    airsAt?: number;
    /**
     * The production this is a beat of, and where it comes in it.
     *
     * Both together or neither, which the table enforces: a beat with no place in its own programme
     * is not a beat. Absent for every ordinary break, which is almost every segment.
     */
    productionId?: string;
    productionOrdinal?: number;
    /**
     * Which character this is written as, when whoever is planning it already knows.
     *
     * Absent for every ordinary break, where the words are written later and {@link writeScript}
     * stamps it. A production beat is the exception: it arrives with its script and with a SPEAKER
     * who may not be the presenter, so the row has to say so from the moment it exists.
     */
    personaId?: string;
    /** The request that asked for this break. See {@link Segment.requestId}. */
    requestId?: string;
    /**
     * What this break is ABOUT, for one the station planted for itself.
     *
     * The planted sibling of a request's `context`, and it travels on the ROW for the same reason
     * `airsAt` does: the words are asked for on a later pass than the one that planted the break.
     * Unlike `airsAt` it needs no revising, because what a break is ABOUT is a decision rather than a
     * projection and the order moving under it does not make it another subject. Deliberately
     * shapeless — the writers for a kind read what they expect and nothing generic reads it. For a
     * news bulletin planted by a band, the category the band named.
     */
    context?: BreakContext;
}

/** What the renderer writes back when it worked. */
export interface RenderedAudio {
    audioChecksum: string;
    audioExt: SegmentExtension;
    durationMs?: number;
    /**
     * The words the engine was handed. See {@link Segment.spokenScript}.
     *
     * Written in the same statement as the audio, because it is a fact ABOUT this audio rather than
     * about the row: two renders of one script under two different pronunciation lists produce two
     * different readings, and the one kept has to be the one whose file this row now points at.
     */
    spokenScript?: string;
}

/** What the station wrote itself, as opposed to `library` for a file somebody dropped in. */
export const RENDER_SOURCE = 'render';

/**
 * What a sweep for stranded claims handed back, kept apart by which claim it was.
 *
 * Two lists rather than one, because they resume at different stages and a caller acts on that: a
 * released `writing` row needs its words asked for again, and a released `rendering` row needs only
 * its audio.
 */
export interface StrandedRelease {
    writing: string[];
    rendering: string[];
}

/**
 * A production's beats as one row: audio first, like an import, and owned by the production.
 *
 * See {@link SegmentRepository.planJoined}. It carries no `voice` on purpose — a phone-in holds
 * several — and no ordinal, which is what makes it the programme rather than a beat of it.
 */
export interface JoinedSegment {
    productionId: string;
    kind: string;
    label: string;
    /** The beats' words in order. Kept to be read, never to be spoken. */
    script?: string;
    audioChecksum: string;
    audioExt: SegmentExtension;
    durationMs?: number;
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
    spokenScript: string | null;
    source: string;
    sourcePath: string | null;
    audioChecksum: string | null;
    audioExt: string | null;
    durationMs: number | null;
    loudnessLufs: number | null;
    error: string | null;
    voice: string | null;
    writer: string | null;
    claimsItemId: string | null;
    airsAt: DateTime | null;
    claimsTimeFrom: DateTime | null;
    claimsTimeUntil: DateTime | null;
    claimsReadingUntil: DateTime | null;
    requestId: string | null;
    context: unknown;
    productionId: string | null;
    productionOrdinal: number | null;
    /** Read through {@link padHitsIn}, so an unreadable value is a break that hits nothing. */
    pads: unknown;
}

const SEGMENT_COLUMNS = [
    'id',
    'kind',
    'state',
    'label',
    'script',
    'spokenScript',
    'source',
    'sourcePath',
    'audioChecksum',
    'audioExt',
    'durationMs',
    'loudnessLufs',
    'error',
    'voice',
    'writer',
    'claimsItemId',
    'airsAt',
    'claimsTimeFrom',
    'claimsTimeUntil',
    'claimsReadingUntil',
    'requestId',
    'context',
    'productionId',
    'productionOrdinal',
    'pads',
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
        ...(row.spokenScript == null ? {} : { spokenScript: row.spokenScript }),
        ...(row.sourcePath == null ? {} : { sourcePath: row.sourcePath }),
        ...(row.durationMs == null ? {} : { durationMs: row.durationMs }),
        ...(row.loudnessLufs == null ? {} : { loudnessLufs: row.loudnessLufs }),
        ...(row.error == null ? {} : { error: row.error }),
        ...(row.voice == null ? {} : { voice: row.voice }),
        ...(row.writer == null ? {} : { writer: row.writer }),
        ...(row.claimsItemId == null ? {} : { claimsItemId: row.claimsItemId }),
        pads: padHitsIn(row.pads),
        ...(row.requestId == null ? {} : { requestId: row.requestId }),
        // Read back defensively, like every other jsonb column here: a value that is not an object
        // is a context nothing can read, and no context and an unreadable one are one state to every
        // caller. See `contextIn`.
        ...contextIn(row.context),
        ...(row.productionId == null || row.productionOrdinal == null
            ? {}
            : { productionId: row.productionId, productionOrdinal: row.productionOrdinal }),
        ...(millisOf(row.airsAt) === undefined ? {} : { airsAt: millisOf(row.airsAt)! }),
        ...(millisOf(row.claimsTimeFrom) === undefined || millisOf(row.claimsTimeUntil) === undefined
            ? {}
            : { claimsTime: { from: millisOf(row.claimsTimeFrom)!, until: millisOf(row.claimsTimeUntil)! } }),
        ...(millisOf(row.claimsReadingUntil) === undefined ? {} : { claimsReadingUntil: millisOf(row.claimsReadingUntil)! }),
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

    /**
     * A production's beats, in the order they are meant to be heard.
     *
     * The read every pass makes, and the reason `production_ordinal` exists: a production is an
     * ORDER rather than a set, so a beat being drafted can be shown the ones already written without
     * being shown the ones that are not.
     *
     * Ordered in SQL rather than by the caller, so the sequence cannot depend on which pass asked.
     *
     * A row with this production's id and NO ordinal is the JOINED programme rather than a beat of
     * it, and it is excluded here rather than filtered by each caller: every pass counts what this
     * answers, and the console reports its length as the beat count.
     */
    async beatsOf(productionId: string): Promise<Segment[]> {
        const rows = await this.db
            .selectFrom('deadair.segments')
            .select(SEGMENT_COLUMNS)
            .where('productionId', '=', productionId)
            .where('productionOrdinal', 'is not', null)
            .orderBy('productionOrdinal', 'asc')
            .execute();

        return rows.map(row => toSegment(row as SegmentRow));
    }

    /**
     * The whole production as one row, once its beats have been joined.
     *
     * The sibling of {@link beatsOf} and the exact complement of it: this production's id with NO
     * ordinal. Absent means the join has not run, could not run, or the analyzer declined — three
     * causes with one consequence, which is that the block airs as its beats.
     */
    async joinedOf(productionId: string): Promise<Segment | undefined> {
        const row = await this.db
            .selectFrom('deadair.segments')
            .select(SEGMENT_COLUMNS)
            .where('productionId', '=', productionId)
            .where('productionOrdinal', 'is', null)
            .executeTakeFirst();

        return row === undefined ? undefined : toSegment(row);
    }

    /**
     * A production's beats, joined into one row that is ready to air.
     *
     * Born `ready`, exactly as {@link importFile}'s row is and for the same reason: the audio came
     * first and there is nothing left to produce. **That is a safety property rather than a
     * shortcut.** `claimForRender` starts at `written`, so a row that began there would eventually
     * be claimed by a retry sweep and hand a whole programme's script to the speech engine as one
     * line, in one voice — every turn of a phone-in read by the presenter. `ready` is not claimable,
     * so it cannot happen.
     *
     * The script is the beats' own words in order, kept for the console and for `/scripts`, and
     * nothing will ever speak it. `voice` is deliberately absent: the row holds several.
     */
    async planJoined(joined: JoinedSegment): Promise<Segment> {
        const row = await this.db
            .insertInto('deadair.segments')
            .values({
                stationKey: this.identity.stationKey,
                kind: joined.kind,
                label: joined.label,
                script: joined.script ?? null,
                source: RENDER_SOURCE,
                productionId: joined.productionId,
                // No ordinal, which is what says this is the whole production rather than a beat of
                // it. See the constraint in migration 0016.
                productionOrdinal: null,
                audioChecksum: joined.audioChecksum,
                audioExt: joined.audioExt,
                durationMs: joined.durationMs ?? null,
                state: 'ready',
            })
            .returning(SEGMENT_COLUMNS)
            .executeTakeFirstOrThrow();

        await this.record(row.id, undefined, 'ready', 'the beats were joined into one');
        return toSegment(row);
    }

    /**
     * How many breaks the station has written since the last one that hit a pad.
     *
     * What the deterministic floor's spacing is judged against, and it is counted from the ROWS
     * rather than held in memory for `ReadLog`'s inverse reason: a bulletin's read log is a question
     * with a twelve-hour half-life and a restart costing one repeated story, where this is a
     * rhythm — a station restarted every hour would hit a pad on the first break every time, which
     * is the one pattern a listener would actually notice.
     *
     * Counted over everything the station WROTE rather than over what aired, because a break dropped
     * before its slot still spent its pad (`PadRepository.markUsed` stamps at selection, and this has
     * to agree with it or the two would disagree about what happened). Segments with no script are
     * excluded: an imported ident is not a break the station wrote, and counting the library would
     * make the spacing a function of how many files an operator dropped in.
     *
     * A station that has never hit one answers the count of everything it has ever written, which is
     * large and is the right answer: the floor is overdue.
     */
    async breaksSincePad(): Promise<number> {
        const row = await this.db
            .selectFrom('deadair.segments')
            .select(({ fn }) => fn.countAll<string>().as('count'))
            .where('stationKey', '=', this.identity.stationKey)
            .where('script', 'is not', null)
            .where(
                'createdAt',
                '>',
                // `coalesce` to the epoch rather than a branch on "has anything ever hit one", so
                // this stays a single round trip: a station with an untouched rack compares every
                // row against a date before it existed and counts them all.
                sql<DateTime>`coalesce((select max(created_at) from deadair.segments where station_key = ${this.identity.stationKey} and jsonb_array_length(pads) > 0), 'epoch'::timestamptz)`,
            )
            .executeTakeFirst();

        return Number(row?.count ?? 0);
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
     *
     * **Nothing belonging to a production is on the shelf.** A production's kind is free text like
     * any other (`callin`, `podcast`), so without this a band naming one would draw a single turn of
     * a past phone-in and air it on its own — half a conversation, with nobody it was half of. The
     * shelf is for the standalone things an operator recorded or the station wrote.
     */
    async listReady(kind: string): Promise<Segment[]> {
        const rows = await this.db
            .selectFrom('deadair.segments')
            .select(SEGMENT_COLUMNS)
            .where('kind', '=', kind)
            .where('state', '=', 'ready')
            .where('productionId', 'is', null)
            .orderBy('createdAt', 'asc')
            .execute();

        return rows.map(toSegment);
    }

    /**
     * Which kinds the shelf holds anything airable of.
     *
     * {@link listReady}'s question asked of every kind at once, and it exists because the console
     * has to answer it for a band whose kind nothing can WRITE: an operator who dropped sponsor
     * spots in the inbox has a working `sponsor` band, and one who has not does not, and those two
     * look identical until something reads the library.
     *
     * `distinct` in SQL rather than a set built here, for `listReady`'s own reason: the library may
     * be thousands of half-rendered talk breaks, and the answer is a handful of words either way.
     */
    async readyKinds(): Promise<string[]> {
        const rows = await this.db
            .selectFrom('deadair.segments')
            .select('kind')
            .distinct()
            .where('state', '=', 'ready')
            // The same exclusion, for the same reason: see {@link listReady}. A station that has
            // ever made a phone-in would otherwise be told its `callin` band can be filled from the
            // shelf, which is the console reporting the wrong answer to the one question this asks.
            .where('productionId', 'is', null)
            .execute();

        return rows.map(row => row.kind);
    }

    /**
     * When each of these characters was last written into a segment, as epoch millis.
     *
     * What a rotation needs and nothing more: a character absent from the answer has never spoken,
     * which is what puts a newly written caller at the FRONT of the queue rather than the back.
     *
     * Read off the segments rather than kept in a column of its own, on the rule this tree applies
     * everywhere: the row already records who a segment was written as, and a second store of the
     * same fact is a second thing that can disagree. Every state counts, including a beat that was
     * written and never aired — a character the station has just spent a programme on has been
     * heard from recently whatever happened to the audio, and the alternative is casting them again
     * on the next one.
     */
    async lastSpokenBy(personaIds: readonly string[]): Promise<Map<string, number>> {
        if (personaIds.length === 0) return new Map();

        const rows = await this.db
            .selectFrom('deadair.segments')
            .select(({ fn }) => ['personaId', fn.max('createdAt').as('at')])
            .where('personaId', 'in', [...personaIds])
            .groupBy('personaId')
            .execute();

        return new Map(
            rows.flatMap(row => {
                const at = row.at as unknown as Date | { toMillis(): number } | null;
                if (row.personaId == null || at == null) return [];
                return [[row.personaId, at instanceof Date ? at.getTime() : at.toMillis()] as [string, number]];
            }),
        );
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
                personaId: planned.personaId ?? null,
                writer: planned.writer ?? null,
                pads: JSON.stringify(planned.pads ?? []),
                airsAt: planned.airsAt === undefined ? null : instant(planned.airsAt),
                requestId: planned.requestId ?? null,
                context: planned.context === undefined ? null : sql<string>`${JSON.stringify(planned.context)}::jsonb`,
                productionId: planned.productionId ?? null,
                productionOrdinal: planned.productionOrdinal ?? null,
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
        written: {
            script: string;
            label: string;
            writer: string;
            claimsItemId?: string;
            claimsTime?: { from: number; until: number };
            claimsReadingUntil?: number;
            personaId?: string;
            voice?: string;
            pads?: readonly PadHit[];
        },
    ): Promise<boolean> {
        const result = await this.db
            .updateTable('deadair.segments')
            .set({
                script: written.script,
                label: written.label,
                writer: written.writer,
                state: 'written',
                // Who the station was when these words were decided. In the SAME statement as the
                // words for the same reason the claims are: a persona swapped between the write and
                // the render would otherwise file a pirate's sentence under the late-night host.
                // Null when there was none, so a rewrite off air does not leave a stale character.
                personaId: written.personaId ?? null,
                // The voice is set only when one is OFFERED, which is the opposite of everything
                // else here and deliberate. A segment planned by hand through `POST /segments` may
                // name its own, and that is an explicit instruction from an operator rather than a
                // default to be recomputed; the caller reads the row first and offers the persona's
                // only when the row has none. Absent here therefore means leave it exactly alone.
                ...(written.voice === undefined ? {} : { voice: written.voice }),
                // Set together with the words, because it describes them: a claim is a statement
                // the script makes, and one outliving a rewrite would be a promise about a
                // sentence that is no longer there. Null clears it for the same reason.
                // Written with the words for `claimsItemId`'s reason exactly: it describes THESE
                // words, and a hit outliving a rewrite would play a sound for a sentence that is no
                // longer there. Reset to empty rather than left alone, which is the same clearing
                // the two claims below do.
                pads: JSON.stringify(written.pads ?? []),
                claimsItemId: written.claimsItemId ?? null,
                // The same argument in the other dimension: a break naming a TIME is overtaken by
                // the clock the way one naming the next record is overtaken by an edit. Written
                // with the words because the window comes from the phrasing, and cleared with them
                // for the same reason.
                claimsTimeFrom: written.claimsTime === undefined ? null : instant(written.claimsTime.from),
                claimsTimeUntil: written.claimsTime === undefined ? null : instant(written.claimsTime.until),
                // And the third: a break that REPORTED a measurement is overtaken by the world.
                // Written and cleared with the words for the same reason as the two above — the
                // expiry describes the observation THESE words state, and a rewrite states another.
                claimsReadingUntil: written.claimsReadingUntil === undefined ? null : instant(written.claimsReadingUntil),
            })
            .where('id', '=', id)
            .where('state', '=', 'writing')
            .executeTakeFirst();

        const wrote = (result.numUpdatedRows ?? 0n) > 0n;
        if (wrote) await this.record(id, 'writing', 'written');

        return wrote;
    }

    /**
     * Move each break's projected air time to where the order now says it lands.
     *
     * `airs_at` is a PROJECTION, and until this existed it was stamped once when the break was
     * planted and never revised — which the field's own note said out loud ("nothing recomputes the
     * schedule in between") as though it were a property rather than a bug. It is read by
     * `WriteBreakJob` to derive the clock, the greeting and the daypart, and by `patienceFor` to
     * decide how long the break may wait for a model slot. Both of those are questions about the
     * moment the words are SPOKEN, so both were being answered from a number that stopped being
     * true the first time the order drifted.
     *
     * ## The loop this closes
     *
     * A break planted forty minutes ahead is projected forty minutes ahead, and the projection is a
     * lower bound over items whose lengths are partly unknown. When the order runs late past it, the
     * phrasing the break was written with — "coming up to quarter to one" — falls out of the window
     * `claims_time_*` records, `brokenClaim` reports `late`, and `BreakPlanner.rewriteStale` reopens
     * it. The rewrite then derived the SAME phrasing from the SAME unrevised `airs_at` and stamped
     * the SAME already-closed window, so the next pass reopened it again, once per boundary, until
     * the slot arrived and the break was dropped for still being `planned`.
     *
     * That is precisely the loop `break.claims.ts` documents for an EARLY time claim and excludes
     * from rewriting. `late` was left in on the reading that "the slot has drifted past the phrasing
     * and a rewrite fixes it", which is true only if the rewrite is told where the slot actually is.
     * This is what tells it. Measured on the live station on 30 August: 234 reopens in seven days,
     * one break written twelve times, and 76 breaks passed over at their slot for being `planned`.
     *
     * With the projection current, a rewrite derives a phrasing for a moment that has not passed, so
     * the verdict becomes `early` at worst — which the planner already refuses to act on, and which
     * is therefore where the loop terminates rather than where it restarts.
     *
     * ## What it deliberately does not touch
     *
     * `writing` and `rendering` are left alone. Not for {@link reopen}'s reason — this moves no
     * state and takes nothing out from under a job — but because the job holding such a row has
     * ALREADY read `airs_at` and derived its phrasing from it, so re-stamping under it would leave
     * the row describing a projection its own words were not written from. They are caught on the
     * next pass, in whatever state they finish in.
     *
     * A row already at the value it would be given is skipped by the statement rather than by the
     * caller, so a settled order costs one query and no writes.
     *
     * Best-effort at the call site, like everything else that repairs rather than decides: a
     * projection that could not be written leaves the row exactly as stale as it already was.
     *
     * @param projections segment id to when the order now says that segment airs, as epoch millis.
     * @returns how many rows actually moved.
     */
    async reprojectAirTimes(projections: ReadonlyMap<string, number>): Promise<number> {
        if (projections.size === 0) return 0;

        // A VALUES join rather than one statement per row: the window is small but this runs on
        // every boundary, and the alternative is a round trip per break to write one column.
        const rows = [...projections].map(([id, at]) => sql`(${id}::uuid, ${instant(at)})`);

        const result = await sql<never>`
            update deadair.segments as s
            set airs_at = v.airs_at
            from (values ${sql.join(rows)}) as v (id, airs_at)
            where s.id = v.id
              and s.station_key = ${this.identity.stationKey}
              and s.state in ('planned', 'written', 'ready')
              and s.airs_at is distinct from v.airs_at
        `.execute(this.db);

        return Number(result.numAffectedRows ?? 0);
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

        return await this.reopen('claimsItemId', itemIds, 'the record it promised is no longer going to air');
    }

    /**
     * The same repair, for a caller that has already worked out WHICH breaks are stale.
     *
     * {@link reopenClaims} asks the question in the database, which it can because a record leaving
     * the order names itself. The other half cannot: whether a break's promise still holds depends
     * on where it sits in the running order and on the clock, and neither is in this table. So
     * `BreakPlanner` answers that with `brokenClaim` over the window it is already reading and hands
     * the verdict here.
     *
     * Everything above about the state guard and the absent deadline applies unchanged. It is the
     * same statement with a different `where`.
     *
     * **The reason comes from the caller**, unlike the other two here, and that is the one asymmetry
     * worth explaining. Those each describe a single fault a single call site found, so the sentence
     * is a property of the statement. Three different faults reach this one — the order moved, the
     * clock moved, the world moved — and only the caller holds the verdict that says which. It said
     * "what it said is no longer true of the running order" for all three until 30 August, which
     * recorded a clock fault as an edit to the running order and sent whoever read it to look at an
     * order that had never changed. `reasonFor` in `break.claims.ts` owns the vocabulary, beside the
     * verdicts it is written from.
     */
    async reopenSegments(ids: readonly string[], reason: string): Promise<string[]> {
        if (ids.length === 0) return [];

        return await this.reopen('id', ids, reason);
    }

    /**
     * The same repair again, for breaks the station's OUTGOING presenter wrote.
     *
     * A recast is the third way words stop being the right ones, and the least obvious: nothing
     * about them is untrue, they are simply in somebody else's character and somebody else's voice.
     * Left alone they would air minutes after the operator changed the host, which reads as the
     * change not having taken. So they go back to `planned` and `BreakPlanner.ripen` asks for them
     * again, under whoever is presenting by then.
     *
     * Two things narrow it beyond {@link reopenSegments}, and both are about not taking work that
     * was never the outgoing host's. **A row with no `personaId` is left alone** — a canned ident, a
     * break written while the station had no persona at all, or a script an operator typed
     * themselves is not in anybody's character and rewriting it would throw away words nobody asked
     * to replace. And **a row already stamped with the incoming host is left alone**, which is what
     * makes this safe to call when nothing actually changed.
     *
     * `personaId` is cleared with the script on `writeScript`'s own argument, that it describes the
     * words. `voice` is cleared only where it IS the voice of the persona stamped on that ROW,
     * which is why it is a subquery rather than a value the caller passes: `writeScript` keeps a
     * voice an operator set by hand through `POST /segments` and only fills in the persona's where
     * the row had none, so blanket-clearing would silently discard that instruction, while clearing
     * nothing would have the new character speak in the old one's voice — `WriteBreakJob` computes
     * `segment.voice ?? persona?.voice`. Asking the row rather than the caller also means a tail
     * holding breaks by two different outgoing hosts is handled in one statement. A stamped persona
     * always resolves, because `segments.persona_id` is `on delete set null` and a row whose host
     * was deleted has already fallen out of the guard above.
     *
     * @param ids the segments in the running order that have not been handed to the player.
     * @param personaId who is presenting NOW. Absent is a station that has chosen nobody, and every
     *   break with a host is then out of character.
     */
    async recast(ids: readonly string[], personaId?: string): Promise<string[]> {
        if (ids.length === 0) return [];

        return await this.reopen('id', ids, 'the station changed presenter', { personaId, recast: true });
    }

    /**
     * Back to `planned`, for whichever rows the caller named.
     *
     * The state guard is the load-bearing part and is why this is one method rather than two
     * similar ones: `writing` and `rendering` must never be reset, because both are a job's claim
     * and a row moved underneath one finishes into a state its caller no longer owns.
     *
     * `host` is the recast's extra half and is absent for the two callers that are about a break's
     * CONTENT rather than about who said it. See {@link recast}.
     *
     * ## Why there is a CTE, and why the guard is written twice
     *
     * `segment_events` wants the state the row LEFT, and `returning` on an update answers with the
     * state it arrived at — so for as long as this existed it recorded a flat `written` for every
     * row it moved, while the guard admits three. A break that was fully rendered and `ready` was
     * therefore logged as `written -> planned`, which is not a cosmetic slip: it hides that the
     * rewrite threw away a finished, spoken audio file, and the timeline reads as though nothing
     * was spent. Found on the live station on 30 August, where one break was reopened four times
     * with a `rendering -> ready` immediately before each one and every reopen claimed `written`.
     *
     * The `before` CTE captures `(id, state)` as they stand and the update joins to it, which
     * PostgreSQL has answered since long before `RETURNING OLD.*` arrived in 18 — deliberately, on
     * this being a self-hostable station rather than one pinned to a major version for the sake of
     * an audit column.
     *
     * **{@link reopening} applies the guard to BOTH, and that duplication is the point.** The CTE
     * sees the snapshot the statement opened with; the update re-checks its own `where` against the
     * row it locks. Filtering only in the CTE would let a row that became `writing` between the two
     * be reset underneath the job that had just claimed it — the one thing the guard exists to
     * prevent — and filtering only in the update would let the CTE hand back a state for a row the
     * update passed over. Neither is a state a test would notice, so they share one builder.
     */
    private async reopen(
        by: 'id' | 'claimsItemId',
        values: readonly string[],
        reason: string,
        host?: { personaId?: string; recast: true },
    ): Promise<string[]> {
        const guard = this.reopening(by, values, host);

        const query = this.db
            .with('before', db => db.selectFrom('deadair.segments').select(['deadair.segments.id', 'deadair.segments.state']).where(guard))
            .updateTable('deadair.segments')
            .set({
                state: 'planned',
                script: null,
                writer: null,
                claimsItemId: null,
                claimsTimeFrom: null,
                claimsTimeUntil: null,
                // Cleared with the other two, and this one has a bite the others do not: a reopened
                // break that kept its old expiry is stale the instant it is read, so the next pass
                // reopens it again, forever, against a number that can never move. The words go, so
                // everything that described them goes with them.
                claimsReadingUntil: null,
                ...(host === undefined
                    ? {}
                    : {
                          personaId: null,
                          // Per ROW rather than per statement, which is why it is a subquery: two
                          // segments in the same window can legitimately disagree about whether
                          // their voice came from their persona or from the operator, and about
                          // which persona it was.
                          voice: sql<string | null>`case
                            when voice = (select p.voice from deadair.personas p where p.id = segments.persona_id) then null
                            else voice
                          end`,
                      }),
            })
            .from('before')
            .whereRef('deadair.segments.id', '=', 'before.id')
            .where(guard);

        // `before.state` rather than the updated row's, which is now `planned` for every one of
        // these and says nothing. It arrives already narrowed to {@link SegmentState}, so there is
        // no cast here on purpose: one would go on compiling if the column ever widened.
        const rows = await query.returning(['deadair.segments.id as id', 'before.state as previous']).execute();

        for (const row of rows) await this.record(row.id, row.previous, 'planned', reason);
        return rows.map(row => row.id);
    }

    /**
     * Which rows a reopen may touch, as one expression both halves of the statement are narrowed by.
     *
     * Built once and handed to each rather than written twice, so the CTE that reads the old state
     * and the update that writes the new one cannot come to disagree about which rows they are
     * about. See {@link reopen} for why both need it. Every clause here is a rule with its own
     * reason:
     *
     * **`writing` and `rendering` are never reset**, because both are a job's claim and a row moved
     * underneath one finishes into a state its caller no longer owns. `failed` is out for a
     * different reason — the words on it are gone, so there is nothing to un-write.
     *
     * **A row with no persona is not recast.** A canned ident, a break written while the station had
     * no persona at all, or a script an operator typed themselves is not in anybody's character, and
     * rewriting it would throw away words nobody asked to replace.
     *
     * **A row already stamped with the incoming host is left alone**, which is what makes a recast
     * safe to call when nothing actually changed.
     *
     * **A production beat is never recast alone.** A recast re-offers whatever the outgoing host had
     * lined up, which is right for a break — another writer takes it and the station carries on. A
     * beat is not disposable that way: the block enters the running order whole or not at all, so
     * reopening one of its turns leaves a hole in the middle of a programme that nothing puts back.
     * It bites the moment a beat carries a persona at all, which is exactly what casting made true —
     * a caller's turn differs from the incoming host by definition, so every caller on the station
     * would be rewritten as a talk break by the next changeover. Re-making a production is a
     * decision about the whole production.
     *
     * Every column is TABLE-QUALIFIED, which is not tidiness: the update joins a CTE carrying `id`
     * and `state` of its own, so a bare `id` there is "column reference is ambiguous" and the whole
     * statement fails. The CTE does not need the prefix and takes it anyway, because one expression
     * used in two places has to be written for the stricter of them.
     */
    private reopening(by: 'id' | 'claimsItemId', values: readonly string[], host?: { personaId?: string }): Expression<SqlBool> {
        const eb = expressionBuilder<DB, 'deadair.segments'>();

        const clauses = [eb(`deadair.segments.${by}`, 'in', [...values]), eb('deadair.segments.state', 'in', ['planned', 'written', 'ready'])];

        if (host !== undefined) {
            clauses.push(eb('deadair.segments.personaId', 'is not', null));
            if (host.personaId !== undefined) clauses.push(eb('deadair.segments.personaId', '<>', host.personaId));
            clauses.push(eb('deadair.segments.productionId', 'is', null));
        }

        return eb.and(clauses);
    }

    /**
     * Give back the rows whose job died holding the claim.
     *
     * `writing` and `rendering` are claims a job took with a conditional update, which is what makes
     * a duplicate send free — and the same property is what makes a job that never finished
     * permanent. A worker killed after `claimForWrite` leaves the row in `writing`; pg-boss re-sends
     * the job, its own `claimForWrite` finds nothing in `planned` to take, and it stops. Nothing
     * else ever looks. The break is then skipped at its slot, and at every slot it is ever put in.
     *
     * Each state goes back to where its work would have STARTED, which is not the same place:
     * a `writing` row has no words yet, so it becomes `planned` and is written from scratch; a
     * `rendering` row has them on it, so it becomes `written` and `claimForRender` re-speaks exactly
     * the words that were already decided rather than paying a writer to invent different ones.
     * That is the whole reason `written` is its own state.
     *
     * A `rendering` row with no script is left alone: it should not exist — the write job commits
     * the words before it sends the render — and the render job's own failure path says so on the
     * row rather than this silently inventing a state for it.
     *
     * **The bound is the caller's**, because how long is too long is a fact about the JOB rather
     * than about this table, and the two have very different answers (see `job.mappings.ts`). What
     * this owns is that `updated_at` is a truthful clock for it: `deadair.set_updated_at` moves it
     * on every real change, so it is the moment the claim was taken.
     */
    async releaseStranded(ids: readonly string[], before: { writing: number; rendering: number }): Promise<StrandedRelease> {
        if (ids.length === 0) return { writing: [], rendering: [] };

        return {
            writing: await this.release(ids, 'writing', 'planned', before.writing, 'the job that was writing it never finished'),
            rendering: await this.release(ids, 'rendering', 'written', before.rendering, 'the job that was rendering it never finished'),
        };
    }

    /**
     * The breaks here whose words survived a render that did not, and how often each has failed.
     *
     * `claimForRender` already accepts `failed` and re-speaks what is on the row, because "an
     * operator asking again for a segment whose engine was down is asking for exactly that". This is
     * what lets the station ask on its own behalf. Every failed segment on this station is that
     * exact case: a speech server that was not running, with a perfectly good script beside it.
     *
     * **A row with no script is deliberately not here.** That is the other failure — nothing had
     * anything true to say — and asking again does not change it.
     *
     * The count comes from `segment_events` rather than from a column, because the table that
     * records every transition already knows: no migration, and the number stays true across a
     * restart, which an in-memory tally would not. It counts every failure this row has ever had
     * rather than a recent window, which is the conservative direction — a break that has failed
     * three times is more likely to be a break nothing can speak than a run of bad luck.
     */
    async failedWithScript(ids: readonly string[]): Promise<Array<{ id: string; failures: number }>> {
        if (ids.length === 0) return [];

        const rows = await this.db
            .selectFrom('deadair.segments as s')
            .leftJoin('deadair.segmentEvents as e', join => join.onRef('e.segmentId', '=', 's.id').on('e.toState', '=', 'failed'))
            .select(['s.id', sql<string>`count(e.id)`.as('failures')])
            .where('s.id', 'in', [...ids])
            .where('s.state', '=', 'failed')
            .where('s.script', 'is not', null)
            .groupBy('s.id')
            .execute();

        return rows.map(row => ({ id: row.id, failures: Number(row.failures) }));
    }

    /** One stranded state, back to where its work starts. */
    private async release(ids: readonly string[], from: SegmentState, to: SegmentState, before: number, reason: string): Promise<string[]> {
        let query = this.db
            .updateTable('deadair.segments')
            .set({ state: to })
            .where('id', 'in', [...ids])
            .where('state', '=', from)
            .where('updatedAt', '<', instant(before));

        // See the note above: words on the row are what `written` MEANS, so a render that stranded
        // without any is not something this can hand back.
        if (to === 'written') query = query.where('script', 'is not', null);

        const rows = await query.returning('id').execute();

        for (const row of rows) await this.record(row.id, from, to, reason);
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
                   -- The soundboard hits, which the render path splits and joins around. Spelled out
                   -- because this is the one read in the file that does NOT go through
                   -- SEGMENT_COLUMNS: the claim has to be a single statement against a self-join to
                   -- see the prior state, so its column list is hand-written and a column added
                   -- anywhere else never arrives here.
                   --
                   -- It shipped missing, and the failure is worth recording because nothing caught
                   -- it. An absent value reads as an empty array, which is exactly what an ordinary
                   -- break looks like, so a padded break rendered as plain words with no error
                   -- anywhere and every test still passed -- they build a Segment by hand and never
                   -- come through this statement at all.
                   s.pads,
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
                spokenScript: audio.spokenScript ?? null,
                error: null,
            })
            .where('id', '=', id)
            .execute();

        await this.record(id, 'rendering', 'ready');
    }

    /**
     * How loud the audio turned out, once the analyzer has said.
     *
     * Its own write rather than part of {@link markReady}, and that ordering is the point: the
     * segment is airable the moment the audio exists, and measuring it is a round trip to a sidecar
     * that may be slow, may fail, or may not exist. Holding `ready` back for it would trade a break
     * at slightly the wrong level for no break at all.
     *
     * Deliberately unconditional on state. A segment re-rendered between the measurement being
     * asked for and it arriving would be measured against audio it no longer has — the window is
     * the length of one decode of a few seconds of speech, and the cost of losing that race is one
     * break at the previous take's level. Guarding it with a checksum comparison would be a column
     * read, a race of its own, and a defence against something inaudible.
     */
    async recordLoudness(id: string, loudnessLufs: number): Promise<void> {
        await this.db.updateTable('deadair.segments').set({ loudnessLufs }).where('id', '=', id).execute();
    }

    /**
     * Hand a render back because the HOST was not ready, not because the segment was wrong.
     *
     * `rendering → written`, which is where {@link claimForRender} starts, so the existing
     * `retryRenders` path picks the row up again with none of `MAX_RENDER_ATTEMPTS` spent — the
     * words are intact and nothing about them has been judged. That is the difference this method
     * exists to draw: {@link markFailed} says the station tried and could not, and this says it
     * never got to try. Counting the second as the first is what
     * `docs/todo/render-plugin-readiness.md` is about, and it costs a waiting request outright.
     *
     * Conditional on `rendering` so it can only ever undo this job's own claim, and unlike
     * {@link release} it carries no clock: the caller is the job holding the claim right now, so
     * there is no staleness question to ask.
     */
    async releaseForRetry(id: string, reason: string): Promise<boolean> {
        const rows = await this.db
            .updateTable('deadair.segments')
            .set({ state: 'written' })
            .where('id', '=', id)
            .where('state', '=', 'rendering')
            .returning('id')
            .execute();

        if (rows.length === 0) return false;

        await this.record(id, 'rendering', 'written', reason);
        return true;
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
    /**
     * Take a segment out of the library for good.
     *
     * The narrow half of {@link importFile}, and the only DELETE on this table: everything else that
     * takes a segment out of circulation marks it (`failed`) or splices it out of the running order,
     * because the row is the record of something the station did. What makes this expressible is the
     * caller deleting the inbox FILE in the same breath — without that, the next scan reads the
     * recording straight back in.
     *
     * Which segments those are is `RenderService.deleteSegment`'s rule rather than this method's: a
     * repository is not where a policy belongs. Nothing is orphaned either way — `segment_events`
     * cascades, and `break_requests.segment_id` and `script_history.segment_id` are both
     * `on delete set null`, so the record of what was written outlives the row it was written for.
     */
    async remove(id: string): Promise<boolean> {
        const result = await this.db
            .deleteFrom('deadair.segments')
            .where('id', '=', id)
            .where('stationKey', '=', this.identity.stationKey)
            .executeTakeFirst();

        return Number(result.numDeletedRows) > 0;
    }

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

/**
 * The context a row holds, as the field a caller spreads.
 *
 * `{}` for anything that is not a plain object, which covers null, a hand-edited string and an
 * array. A writer reads keys off this, so handing it a string would have it reaching into
 * characters — and a break with no context is an ordinary break, which is what an unreadable one
 * should look like too.
 */
/**
 * The pad column as something a caller can use, read back defensively like every jsonb column here.
 *
 * A row edited by hand, or one written before the column existed, is a break that hits nothing —
 * which is the same answer as the ordinary break and needs no special case anywhere downstream. An
 * entry missing either half is dropped rather than kept partially: half a hit is a sound with no
 * place in the sentence, or a place with no sound, and both join to nothing.
 */
function padHitsIn(value: unknown): PadHit[] {
    if (!Array.isArray(value)) return [];

    return value.flatMap(entry => {
        if (typeof entry !== 'object' || entry === null) return [];
        const { name, padId } = entry as { name?: unknown; padId?: unknown };
        return typeof name === 'string' && typeof padId === 'string' ? [{ name, padId }] : [];
    });
}

function contextIn(value: unknown): { context?: BreakContext } {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};

    return { context: value as BreakContext };
}
