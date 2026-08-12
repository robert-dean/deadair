import { randomUUID } from 'node:crypto';
import type { LiveOrder } from '#modules/playout/live.order.js';
import type { RundownTrack } from '#modules/playout/rundown.js';

/**
 * The station's live running order: every item it means to air, in order, each
 * carrying its own state.
 *
 * **One per station, and it is not a library.** That is the whole difference
 * between this and {@link Lineup}, which it takes over from. A lineup was asked to
 * be a reusable named list AND the broadcast in progress, and every mechanism that
 * reconciled the two — the cursor, the revision, compaction — was a bug rather
 * than a feature. Prepared material is a PLAYLIST: a provider's, a model's output,
 * eventually `deadair.playlists`. This is built from one when the station goes on
 * air, and it is consumed. See `docs/decisions/on-air-ownership.md`.
 *
 * ## The position is derived, not counted
 *
 * There is no cursor. "What is next" is the first item still {@link planned}, and
 * "what has been heard" is the last one {@link played}. That is not a tidier
 * spelling of the same thing: an integer position can disagree with what actually
 * aired, and every version of that disagreement is one of the four bugs the
 * decision doc lists. A state on the item cannot, because the same fact that moves
 * it is the one the player reported.
 *
 * Implements {@link LiveOrder}, which is the narrow half of this the transport is
 * allowed to touch: it may move an item between states, because it is the thing that
 * hands items over and reads the player back, and it may not reorder, append or
 * remove, because that is programming and programming is the director's.
 *
 * ## Pure memory, and no store
 *
 * Unlike {@link Lineup} this persists nothing and its edits are synchronous. The
 * owner holds it, and the record is written from {@link toSnapshot} on a throttle
 * — memory is the authority and the database is the record, because a station
 * should not need Postgres up to advance a track. Callers therefore cannot forget
 * to await an edit, and a test needs no store at all.
 */

/** What kind of programming this broadcast is. Mirrors `station_lineup.mode`. */
export type StationLineupMode = 'rotation' | 'setlist' | 'feature';

/**
 * What the station does when the order runs out. Mirrors `station_lineup.on_end`.
 *
 * Three arms rather than the five `lineups.on_end` had. `resume` and `rotation`
 * both named another STORED lineup to hand the station back to, and there is no
 * longer one to name. `repeat` survives because under one live order it is
 * {@link resetPlayed} rather than a library workflow: a setlist played across a
 * month is a real thing to want.
 */
export type StationLineupOnEnd = 'extend' | 'repeat' | 'stop';

/**
 * Where one item has got to.
 *
 * The states the rundown used to express as "which array is it in", moved onto the
 * item itself. Three things that buys, none of them cosmetic: the
 * promised-versus-heard distinction becomes a fact about an item rather than a
 * fact about a data structure, a skipped segment becomes something the console can
 * draw instead of a log line, and the ids survive a restart so the app can
 * recognise what the player is airing rather than standing its clock down.
 *
 * There is deliberately no `dropped`. An item handed over and then retracted was
 * never heard, so it goes back to {@link planned} to be offered again; a terminal
 * state for it is precisely how programming an operator planned and paid for gets
 * lost silently. See {@link reclaim}.
 *
 * `skipped` and `removed` are both "this will not be heard", and they are two arms
 * rather than one because they are opposite facts about the station. `skipped` is
 * the station reaching an item and passing over it: a segment with no audio, a
 * record nothing could resolve, a push the player never took. `removed` is an
 * operator cutting one before its turn came. Merging them costs three things — a
 * console that can only describe a removal as one of the ways an item goes wrong,
 * a {@link committedThrough} reduced to guessing which is which from adjacency,
 * and an activity feed that reports an operator's edit as a fault on the page whose
 * whole job is naming why the station is silent.
 *
 * The local-audio arms the decision doc sketches (`resolved`, `warming`, `ready`)
 * are not here because nothing warms audio yet. When they land they are new arms on
 * this union rather than new fields, which is the point of one list of stateful
 * items.
 */
export type StationLineupItemState = 'planned' | 'handed' | 'airing' | 'played' | 'skipped' | 'removed';

/**
 * What is common to every item.
 *
 * `id` is minted here and is durable: it is written to the row, it rides through
 * Liquidsoap on the annotation, and it comes back on the player's own reading. One
 * id for one play, which is what lets a restarted app name what is on air.
 */
interface StationLineupLine {
    id: string;
    kind: StationLineupItemKind;
    state: StationLineupItemState;
}

/** A record. */
export interface StationLineupTrackItem extends StationLineupLine {
    kind: 'track';
    track: RundownTrack;
}

/**
 * Something the station says rather than plays: an ident, a stinger, a talk break.
 *
 * **It holds the segment's id and nothing else about it.** `deadair.segments` is
 * the single truth for the label, the state and the audio, and a copy in here would
 * be a stale answer inside a document rewritten on a throttle — so a segment
 * re-recorded after being planted would air under whatever it used to be.
 */
export interface StationLineupSegmentItem extends StationLineupLine {
    kind: 'segment';
    segmentId: string;
    /**
     * Play this OVER the record that follows it, rather than between two records.
     *
     * Absent is the ordinary case: the segment is an item of the running order in
     * its own right and the listener hears it in the gap. Present makes it a cue
     * instead — it never becomes something the player is handed, and the station
     * ducks the bed under it `atMs` into the next record, which is what a DJ talking
     * over an intro actually is. Liquidsoap does the measuring; nothing here
     * schedules against a clock.
     */
    over?: { atMs: number };
}

export type StationLineupItem = StationLineupTrackItem | StationLineupSegmentItem;

export type StationLineupItemKind = 'track' | 'segment';

/** Per-broadcast overrides of the station's defaults. Absent fields fall through. */
export interface StationLineupRules {
    /** Days a song is suppressed after airing. `0` disables the window. */
    repeatWindowDays?: number;
    /** Minutes an artist is suppressed after airing. `0` disables the cooldown. */
    artistCooldownMinutes?: number;
    /** Most tracks by one artist in a generated batch. `0` disables the cap. */
    maxPerArtist?: number;
    /** Whether the director may generate more when this runs short. */
    autoExtend?: boolean;
    /** Whether the station may put its own segments into this order. */
    breaks?: boolean;
    /** Records between one segment and the next. `0` is the same as `breaks: false`. */
    breakEveryItems?: number;
    /**
     * Whether one record may be blended into the next.
     *
     * Off for a `setlist` and a `feature` without anybody setting it, by the same
     * baseline that turns breaks off for them: an album's gaps are somebody's
     * decision and overlapping them overrules it. Set it here to have a
     * sequenced order blended anyway, or to keep a rotation's boundaries cold.
     */
    crossfade?: boolean;
}

/** Everything about the running order except the items: what the row says it is. */
export interface StationLineupBinding {
    /** What the operator is told is on. A label for this broadcast, not an identity. */
    name: string;
    /**
     * What the operator asked the station to play, in their own words.
     *
     * An instruction rather than a label, which is the whole difference from {@link name}: a
     * generator reads this and programmes against it, and nothing shows it to a listener. It rides
     * the running order rather than a refill's payload because `onEnd: 'extend'` keeps asking for
     * more, and a theme that lasted one batch would drift back to ordinary rotation within the hour.
     *
     * Absent is ordinary and means the station programmes itself as it always has.
     */
    brief?: string;
    mode: StationLineupMode;
    onEnd: StationLineupOnEnd;
    /** Who built it: `import`, or `director` for anything generated. */
    source: string;
    /** Where to pull MORE from. A binding rather than an identity: it can change mid-life. */
    sourcePluginId?: string;
    sourcePlaylistId?: string;
    rules?: StationLineupRules;
}

/** The running order as it is stored: one document per station. */
export interface StationLineupSnapshot extends StationLineupBinding {
    items: StationLineupItem[];
}

/** Why an edit was refused, for a console that has to tell someone standing at the desk. */
export type EditRefusal = 'not-found' | 'already-aired' | 'empty';

/** The outcome of an edit: it happened, or precisely why it did not. */
export type EditResult = { ok: true } | { ok: false; reason: EditRefusal; message: string };

const OK: EditResult = { ok: true };

const refuse = (reason: EditRefusal, message: string): EditResult => ({ ok: false, reason, message });

/**
 * How much of the past to keep in the document.
 *
 * A rotation is appended to forever, so without a bound a station left running for a
 * week carries thousands of dead items. The decision doc claims one owner makes
 * compaction unrepresentable: the MECHANISM goes (there is no revision to guard and
 * no second writer to lose the write to) but the need does not, and pretending
 * otherwise is how the document grows without limit.
 *
 * What is kept is what a console shows as recently played and what a reading of the
 * player can still be recognised against. Never trimmed for a `setlist`, whose
 * played items are exactly what it replays.
 */
export const MAX_PLAYED_KEPT = 20;

/** The states an item is in once it is no longer this broadcast's to decide about. */
const isPast = (state: StationLineupItemState): boolean => state === 'played' || state === 'skipped' || state === 'removed';

export class StationLineup implements LiveOrder {
    private itemList: StationLineupItem[];

    constructor(
        private binding: StationLineupBinding,
        items: StationLineupItem[] = [],
    ) {
        this.itemList = items;
    }

    // ── identity ───────────────────────────────────────────────────────────────

    get name(): string {
        return this.binding.name;
    }

    get mode(): StationLineupMode {
        return this.binding.mode;
    }

    get onEnd(): StationLineupOnEnd {
        return this.binding.onEnd;
    }

    /** Who built it: `import` or `director`. Recorded against everything it airs. */
    get source(): string {
        return this.binding.source;
    }

    /** Which plugin's playlist to pull more from, when it came from one. */
    get sourcePluginId(): string | undefined {
        return this.binding.sourcePluginId;
    }

    get sourcePlaylistId(): string | undefined {
        return this.binding.sourcePlaylistId;
    }

    get rules(): StationLineupRules {
        return this.binding.rules ?? {};
    }

    /** What the operator asked for, for whatever generates more. Empty means they asked for nothing. */
    get brief(): string {
        return this.binding.brief ?? '';
    }

    // ── reading ────────────────────────────────────────────────────────────────

    /** The whole order, including what has already been heard. */
    all(): readonly StationLineupItem[] {
        return this.itemList;
    }

    /**
     * Everything committed but not yet heard, in the order it will air.
     *
     * Items the player is already HOLDING come first, because they are the genuinely
     * next ones. Leaving them out is how a console ends up naming the track after
     * next as "next".
     */
    upcoming(): readonly StationLineupItem[] {
        return this.itemList.filter(item => item.state === 'handed' || item.state === 'planned');
    }

    /** What is on air, as far as the player has told us. */
    airing(): StationLineupItem | undefined {
        return this.itemList.find(item => item.state === 'airing');
    }

    /**
     * The next `count` items nobody has committed to anything yet.
     *
     * Pure: nothing moves and nothing is marked. That is the whole point. The
     * director has async work to do on these before it can hand any of them over — a
     * segment has to be looked up, and it may turn out to be one the station skips —
     * and marking them first means a failure in the middle silently loses
     * programming. Pair it with {@link markHanded}, which is synchronous, so a
     * caller's whole decide-and-commit step is one uninterrupted stretch.
     *
     * Does NOT wrap for a setlist. Wrapping is {@link resetPlayed}, decided at the
     * end of the order by whoever reads {@link onEnd}, because a state put back to
     * `planned` is a thing that happened rather than an index arithmetic nobody can
     * see afterwards.
     */
    nextPlanned(count: number): StationLineupItem[] {
        if (count <= 0) return [];

        const items: StationLineupItem[] = [];
        for (const item of this.itemList) {
            if (item.state !== 'planned') continue;
            items.push(item);
            if (items.length === count) break;
        }
        return items;
    }

    /**
     * How many items are left before this order runs out.
     *
     * The refill trigger, and it counts only what is still `planned`: an item already
     * handed to the player is spent, whether or not the listener has reached it.
     */
    remaining(): number {
        return this.itemList.reduce((count, item) => (item.state === 'planned' ? count + 1 : count), 0);
    }

    size(): number {
        return this.itemList.length;
    }

    isEmpty(): boolean {
        return this.itemList.length === 0;
    }

    /** Whether there is nothing left to commit. What {@link onEnd} is read for. */
    isExhausted(): boolean {
        return this.remaining() === 0;
    }

    /** One item by its id, for a caller holding an id the player gave back. */
    find(itemId: string): StationLineupItem | undefined {
        return this.itemList.find(item => item.id === itemId);
    }

    /**
     * Whether this order holds the item at all.
     *
     * What tells an id from a session before this process started apart from one of
     * ours that has simply moved on. The transport asks it before reporting a fault:
     * see `Rundown.observeOnAir`.
     */
    has(itemId: string): boolean {
        return this.itemList.some(item => item.id === itemId);
    }

    /**
     * The next record after this line, as the order stands right now.
     *
     * What a break's forward claim is checked against at hand-over: it named a line when it was
     * written, and this says which line is actually next by the time it comes round. A scan rather
     * than an index, because the order is short and there is no cursor to keep honest.
     *
     * Skips anything that is not a record, and anything already spent. A break promising "coming
     * up, X" is promising the next RECORD a listener will hear, so a segment between the two does
     * not falsify it, and neither does a line that has already been skipped.
     *
     * `undefined` for a line the order does not hold, and for one with no record after it at all.
     * Both make a claim uncheckable, which the caller treats the same way it treats a broken one.
     */
    nextTrackAfter(itemId: string): StationLineupTrackItem | undefined {
        const at = this.itemList.findIndex(item => item.id === itemId);
        if (at < 0) return undefined;

        for (let index = at + 1; index < this.itemList.length; index++) {
            const item = this.itemList[index]!;
            if (item.kind === 'track' && item.state !== 'skipped') return item;
        }
        return undefined;
    }

    /**
     * The index everything before which belongs to the player.
     *
     * One past the last item this broadcast has done something with, rather than the
     * first `planned` one. The two are the same in the ordinary case, where the order
     * is a spent head followed by a planned tail. They differ after a retraction hands
     * items back mid-order, and taking the first planned index there would open the
     * head up to editing while the player is still holding part of it.
     *
     * What the old `Lineup.cursor()` answered, derived rather than counted.
     *
     * ## A `removed` item is not part of the head
     *
     * Everything else that is not `planned` is: the player was given it, passed over it, or
     * heard it. An operator's cut ({@link remove}) is the one non-`planned` state that says
     * nothing about how far the broadcast has got, and counting it would make everything in
     * front of it unmovable and unplantable — so cutting one break in the middle of the hour
     * would freeze the half of the order before it.
     */
    committedThrough(): number {
        for (let index = this.itemList.length - 1; index >= 0; index--) {
            const state = this.itemList[index]!.state;
            if (state !== 'planned' && state !== 'removed') return index + 1;
        }
        return 0;
    }

    /** The row as it should be stored. */
    toSnapshot(): StationLineupSnapshot {
        return { ...this.binding, items: [...this.itemList] };
    }

    // ── what the player has done ───────────────────────────────────────────────

    /**
     * This item has been given to the player. A promise, not a fact.
     *
     * @returns whether it was still `planned`. False for one an edit has removed or a
     *   retraction has already taken back, which is not a failure: there is simply
     *   nothing truthful to mark.
     */
    markHanded(itemId: string): boolean {
        return this.transition(itemId, 'planned', 'handed');
    }

    /**
     * The player says a listener is hearing this one.
     *
     * Everything committed BEFORE it that never aired is marked `skipped` in the same
     * breath, because that is what the player has just told us: it moved past them. A
     * failed decode, an operator's skip and a push that never landed are the same
     * observation from here, and the reason is a log line rather than a state.
     *
     * Whatever was airing becomes `played`, which is the one honest moment to say so:
     * a record is heard until the next one starts.
     *
     * @returns whether this order holds the item. False for an id from a session
     *   before this process started, which must never be invented into the order.
     */
    markAiring(itemId: string): boolean {
        const index = this.itemList.findIndex(item => item.id === itemId);
        if (index < 0) return false;

        const item = this.itemList[index]!;
        if (item.state === 'airing') return true;

        for (const earlier of this.itemList.slice(0, index)) {
            if (earlier.state === 'airing') earlier.state = 'played';
            else if (earlier.state === 'handed' || earlier.state === 'planned') earlier.state = 'skipped';
        }
        item.state = 'airing';
        return true;
    }

    /** This one is behind us. */
    markPlayed(itemId: string): boolean {
        return this.transition(itemId, 'airing', 'played');
    }

    /**
     * The station will not be airing this one: a segment with no audio, an item
     * nothing could resolve.
     *
     * Terminal, deliberately. The rule that keeps a broken renderer from ever costing
     * the station silence is that an item which is not ready is skipped and never
     * waited for, and a state the director would retry is that wait by another name.
     */
    markSkipped(itemId: string): boolean {
        return this.transition(itemId, 'planned', 'skipped') || this.transition(itemId, 'handed', 'skipped');
    }

    /**
     * Take back items the player was handed and then had taken away from it.
     *
     * **The one place a promise is undone by a fact**, and the reason there is no
     * `dropped` state. Committing an item is a promise and airing it is a fact; a
     * retraction is where they come apart, and an item that was promised and never
     * heard has to be offered again or it is programming the operator planned, paid
     * for and never heard, lost in silence. That was bug 4.
     *
     * Only `handed` items come back. One that was AIRING was heard, at least partly,
     * so it stays `played`: replaying a record a listener is in the middle of is the
     * opposite mistake and just as audible.
     *
     * @returns how many were given back, for a log line.
     */
    reclaim(itemIds: readonly string[]): number {
        const wanted = new Set(itemIds);
        let count = 0;
        for (const item of this.itemList) {
            if (!wanted.has(item.id) || item.state !== 'handed') continue;
            item.state = 'planned';
            count += 1;
        }
        return count;
    }

    /**
     * Take everything the player is holding back, without naming it.
     *
     * What a stand-down or a change of programming does: every promise is off, and
     * what was airing was still heard. The counterpart to {@link reclaim} for a caller
     * that has no list of ids because it is dropping the lot.
     */
    reclaimAll(): number {
        return this.reclaim(this.itemList.filter(item => item.state === 'handed').map(item => item.id));
    }

    // ── editing ────────────────────────────────────────────────────────────────

    /**
     * Start a new broadcast from this material, keeping the binding.
     *
     * Everything already in the order goes, heard or not: this is a change of
     * programming rather than a continuation. What is ON AIR is the transport's
     * business — a new running order is not a reason to cut a listener off mid-record.
     */
    replaceFrom(tracks: readonly RundownTrack[]): void {
        this.itemList = tracks.map(toItem);
    }

    /** Point at somewhere else to pull more from, and relabel. */
    rebind(binding: StationLineupBinding): void {
        this.binding = binding;
    }

    /** Add to the end. Nothing else moves: this is the plan continuing. */
    append(tracks: readonly RundownTrack[]): StationLineupItem[] {
        if (tracks.length === 0) return [];

        const added = tracks.map(toItem);
        this.itemList.push(...added);
        return added;
    }

    /**
     * Put several segments in at once, each at a position in the order as it stands
     * NOW.
     *
     * One call for the batch, which is what the break planner needs: a refill appends
     * fifteen records and wants three breaks among them.
     *
     * Applied from the highest index down, so every `atIndex` still means what the
     * caller meant when they computed it. Insert front-to-back instead and the second
     * placement lands one line late, the third two, and a break planned for "after the
     * fourth record" drifts further the more of them there are.
     */
    insertSegments(placements: readonly { segmentId: string; atIndex: number; over?: { atMs: number } }[]): EditResult {
        if (placements.length === 0) return refuse('empty', 'there is nothing to put in');

        const committed = this.committedThrough();
        if (placements.some(placement => placement.atIndex < committed)) {
            return refuse('already-aired', 'that position has already been handed to the player');
        }

        for (const placement of [...placements].sort((left, right) => right.atIndex - left.atIndex)) {
            const index = Math.min(placement.atIndex, this.itemList.length);
            this.itemList.splice(index, 0, {
                id: randomUUID(),
                kind: 'segment',
                state: 'planned',
                segmentId: placement.segmentId,
                ...(placement.over === undefined ? {} : { over: placement.over }),
            });
        }
        return OK;
    }

    /** Put one segment into the order at a position. */
    insertSegment(segmentId: string, atIndex: number, over?: { atMs: number }): EditResult {
        return this.insertSegments([{ segmentId, atIndex, ...(over === undefined ? {} : { over }) }]);
    }

    /**
     * Move an item to a new position among the ones not yet committed.
     *
     * `toIndex` is absolute, so a console can send back the index it drew. A position
     * inside the committed head is refused rather than clamped: the operator is asking
     * to reorder something a listener is about to hear, and quietly doing something
     * else instead is worse than saying no.
     */
    move(itemId: string, toIndex: number): EditResult {
        const from = this.itemList.findIndex(item => item.id === itemId);
        if (from < 0) return refuse('not-found', 'that item is not in the running order');
        if (this.itemList[from]!.state !== 'planned') return refuse('already-aired', 'that item has already been handed to the player');
        if (toIndex < this.committedThrough()) return refuse('already-aired', 'that position has already been handed to the player');

        const [item] = this.itemList.splice(from, 1);
        this.itemList.splice(Math.min(toIndex, this.itemList.length), 0, item!);
        return OK;
    }

    /**
     * Drop an item that has not been committed yet.
     *
     * **A record is spliced out and a segment is marked `skipped`**, which reads like an
     * inconsistency and is the whole fix for a bug: a removed break used to come back a
     * boundary or two later, between the same two records. `BreakPlanner` is idempotent
     * positionally and by nothing else — it counts records since the last segment ALREADY in
     * the order — so a spliced-out break left an order with a full interval of records and no
     * segment in it, which is indistinguishable from an order that was never planted into. The
     * planner then did the correct thing for that order and planted a break. The operator's
     * delete was not being overruled, it was being forgotten.
     *
     * `removed` is that mark. A segment in ANY state resets the planner's count, so the station
     * goes one interval without talking and then talks again, which is what deleting one break
     * means. Removing a RECORD stays a splice: the two are different requests and only this one
     * has to leave a mark.
     *
     * Its own state rather than {@link skipped}, which would have done the planner's job and
     * nothing else. An operator's cut and the station passing over a break it could not render
     * are opposite facts, and everything downstream that reads one of them — the console's
     * label, {@link committedThrough}, an activity feed — needs to tell them apart. The mark
     * ages out with the rest of the past, through {@link trimPast}.
     */
    remove(itemId: string): EditResult {
        const index = this.itemList.findIndex(item => item.id === itemId);
        if (index < 0) return refuse('not-found', 'that item is not in the running order');

        const item = this.itemList[index]!;
        if (item.state !== 'planned') return refuse('already-aired', 'that item has already been handed to the player');

        if (item.kind === 'segment') item.state = 'removed';
        else this.itemList.splice(index, 1);
        return OK;
    }

    /**
     * Shuffle everything not yet committed.
     *
     * Only the tail, because the head is already in the player's hands. Refuses an
     * empty tail rather than reporting a shuffle that could not have changed anything.
     */
    shuffleRemaining(): EditResult {
        const head = this.itemList.filter(item => item.state !== 'planned');
        const tail = this.itemList.filter(item => item.state === 'planned');
        if (tail.length < 2) return refuse('empty', 'there is nothing left to shuffle');

        for (let index = tail.length - 1; index > 0; index--) {
            const swap = Math.floor(Math.random() * (index + 1));
            [tail[index], tail[swap]] = [tail[swap]!, tail[index]!];
        }
        // The committed head keeps its own order and stays in front, which is the one
        // thing a shuffle must not touch: those items are already with the player.
        this.itemList = [...head, ...tail];
        return OK;
    }

    /** Empty it. What is on air is the transport's business, not this one's. */
    clear(): void {
        this.itemList = [];
    }

    /**
     * Play the whole thing again: what `on_end: 'repeat'` does.
     *
     * Everything heard or passed over goes back to `planned`, which is what wrapping
     * IS here. The old `Lineup` did this by moving an integer back to zero and taking
     * care never to compact a setlist, because the played prefix it was about to drop
     * was the programme.
     */
    resetPlayed(): number {
        let count = 0;
        for (const item of this.itemList) {
            if (!isPast(item.state)) continue;
            item.state = 'planned';
            count += 1;
        }
        return count;
    }

    /**
     * Drop all but the last {@link MAX_PLAYED_KEPT} items that are behind us.
     *
     * Called by whoever persists, not by an edit: it is housekeeping about how much
     * history the document carries rather than a change to the running order. Never
     * for a `setlist`, whose past is what it is about to replay.
     *
     * @returns how many were dropped, for a log line.
     */
    trimPast(keep = MAX_PLAYED_KEPT): number {
        if (this.mode === 'setlist') return 0;

        const past = this.itemList.filter(item => isPast(item.state));
        if (past.length <= keep) return 0;

        const dropping = new Set(past.slice(0, past.length - keep).map(item => item.id));
        this.itemList = this.itemList.filter(item => !dropping.has(item.id));
        return dropping.size;
    }

    // ── internals ──────────────────────────────────────────────────────────────

    /** Move one item between two states, and say whether it was in the first one. */
    private transition(itemId: string, from: StationLineupItemState, to: StationLineupItemState): boolean {
        const item = this.itemList.find(candidate => candidate.id === itemId);
        if (item?.state !== from) return false;

        item.state = to;
        return true;
    }
}

const toItem = (track: RundownTrack): StationLineupItem => ({ id: randomUUID(), kind: 'track', state: 'planned', track });

/** Narrow an item to the records, for anything that reasons about what the station is PLAYING. */
export const isTrackItem = (item: StationLineupItem): item is StationLineupTrackItem => item.kind === 'track';
