import { randomUUID } from 'node:crypto';
import type { AiringResult, LiveOrder } from '#modules/playout/live.order.js';
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
 * the station reaching an item and passing over it: a segment with no audio, a push
 * the player never took. `removed` is an operator cutting one before its turn came.
 * Merging them costs three things — a console that can only describe a removal as one
 * of the ways an item goes wrong, a {@link committedThrough} reduced to guessing which
 * is which from adjacency, and an activity feed that reports an operator's edit as a
 * fault on the page whose whole job is naming why the station is silent.
 *
 * `unavailable` is the third of them, and it earns its place on the same argument: the
 * station could not obtain the AUDIO for a record. It is the only one of the three an
 * operator can do anything about, because it names a copy rather than a decision — the
 * provider answered 502 four times, or every binding is benched — and folding it into
 * `skipped` leaves the one actionable case indistinguishable from a break that was not
 * ready in time. It is otherwise `skipped` in every respect that matters to position:
 * terminal, past, and no reason to hold the broadcast up.
 *
 * The local-audio arms the decision doc sketches (`resolved`, `warming`, `ready`)
 * are not here because nothing warms audio yet. When they land they are new arms on
 * this union rather than new fields, which is the point of one list of stateful
 * items.
 */
export type StationLineupItemState = 'planned' | 'handed' | 'airing' | 'played' | 'skipped' | 'unavailable' | 'removed';

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
     * What sort of segment it is — the same string as `segments.kind`.
     *
     * **The one field of a segment it is safe to keep a copy of here**, and the exception needs
     * saying because the paragraph above forbids exactly this. `label`, `state` and the audio are
     * all things a segment acquires and changes after it is planted, so a copy of one goes stale
     * inside a document written on a throttle. `segments.kind` is set when the row is created and
     * is never updated anywhere — a talk break is never re-recorded as an ident — so there is no
     * later value for this to disagree with.
     *
     * It is here because break spacing is PER KIND: a bulletin at nine says nothing about when the
     * DJ should next name the station, and the walk that decides both has to tell them apart on
     * every commit pass. Reading it back out of the database instead would put a query on every
     * track boundary, against a planting pass whose ordinary cost is no query at all.
     *
     * Absent for an item planted before the station kept track, which reads as the station's own
     * break — which is what every segment in an order written before this existed actually is.
     */
    segmentKind?: string;
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
    /**
     * The block this belongs to, when it is one beat of something bigger.
     *
     * A production is several segments that only mean anything together: beat 4 missing is not a
     * shorter programme, it is a programme with a hole in the middle. So the beats carry a shared id
     * and the two operations that could break them up read it — {@link StationLineup.insertGroup}
     * puts them in all at once, and {@link StationLineup.remove} takes the whole block out rather
     * than leaving the rest to air around the gap.
     *
     * Absent for every ordinary break and ident, which is almost every segment: they stand alone by
     * design, and that is exactly what makes them disposable when one cannot be produced in time.
     */
    groupId?: string;
}

export type StationLineupItem = StationLineupTrackItem | StationLineupSegmentItem;

/** One segment, and where it goes. `segmentKind` is what the spacing walk counts it against. */
export interface SegmentPlacement {
    segmentId: string;
    atIndex: number;
    segmentKind?: string;
    over?: { atMs: number };
    /** The block this is one beat of. See {@link StationLineupSegmentItem.groupId}. */
    groupId?: string;
}

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
    /** Whether the station greets somebody who tunes in to an empty room during this broadcast. */
    welcome?: boolean;
    /** Minutes of airtime between one break and the next of the same kind. `0` is `breaks: false`. */
    breakEveryMinutes?: number;
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
    /**
     * WHICH broadcast this is, as opposed to {@link name}, which is only what it is called.
     *
     * Minted when a running order is built and kept for as long as it airs, so everything written
     * while it runs — what aired, what the station said, why it went quiet — can be asked for by
     * the broadcast rather than by the clock. Absent here means "a new one", and the constructor
     * mints it; the repository passes the stored value back so a restart resumes the same broadcast
     * rather than starting a second one halfway through.
     *
     * It identifies a SPAN, not an object. Nothing looks a broadcast up and no row anywhere is a
     * running order that is not this one, so the rule that a lineup is consumed rather than kept is
     * untouched by having a name for it.
     */
    broadcastId?: string;
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
    /**
     * Who is HOSTING this broadcast, as distinct from who the station is when nobody said.
     *
     * It rides the running order for the same reason {@link brief} does: `onEnd: 'extend'` keeps
     * asking for more, so a host held in a refill's payload would last one batch and the show would
     * change presenter within the hour with nothing saying so.
     *
     * Absent is the ordinary state and means the station's own active persona. That is what keeps a
     * station nobody has thought about this on behaving exactly as it did.
     */
    personaId?: string;
    mode: StationLineupMode;
    onEnd: StationLineupOnEnd;
    /** Who built it: `import`, or `director` for anything generated. */
    source: string;
    /** Where to pull MORE from. A binding rather than an identity: it can change mid-life. */
    sourcePluginId?: string;
    sourcePlaylistId?: string;
    rules?: StationLineupRules;
}

/**
 * The running order as it is stored: one document per station.
 *
 * `broadcastId` is required here where it is optional on the binding, which is the difference
 * between asking for a running order and having one: a snapshot comes off a live {@link StationLineup},
 * which has already minted it.
 */
export interface StationLineupSnapshot extends StationLineupBinding {
    broadcastId: string;
    items: StationLineupItem[];
}

/** Why an edit was refused, for a console that has to tell someone standing at the desk. */
export type EditRefusal = 'not-found' | 'already-aired' | 'empty';

/** The outcome of an edit: it happened, or precisely why it did not. */
export type EditResult = { ok: true } | { ok: false; reason: EditRefusal; message: string };

/**
 * The outcome of a shuffle, which is the one edit that takes items OUT of the running order.
 *
 * Everything else answers with an {@link EditResult} alone because it leaves every row where it
 * was. A shuffle drops the breaks planted into the sequence it has just replaced, so the segment
 * rows behind them have to be retired by whoever asked for it.
 */
export interface ShuffleResult {
    readonly result: EditResult;
    readonly dropped: readonly StationLineupItem[];
}

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
const isPast = (state: StationLineupItemState): boolean =>
    state === 'played' || state === 'skipped' || state === 'unavailable' || state === 'removed';

export class StationLineup implements LiveOrder {
    private itemList: StationLineupItem[];
    private readonly broadcast: string;

    constructor(
        private binding: StationLineupBinding,
        items: StationLineupItem[] = [],
    ) {
        this.itemList = items;
        // Minted HERE rather than at each call site, so building a running order and starting a
        // broadcast are the same act and cannot come apart. A binding that already carries one is
        // a row being read back, which is the same broadcast continuing.
        this.broadcast = binding.broadcastId ?? randomUUID();
    }

    // ── identity ───────────────────────────────────────────────────────────────

    /** Which broadcast this is. Stamped on everything written while it airs. */
    get broadcastId(): string {
        return this.broadcast;
    }

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
    /** Who is hosting this broadcast, or `undefined` for the station's own active persona. */
    get personaId(): string | undefined {
        return this.binding.personaId;
    }

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
     * not falsify it, and neither does a line that has already been skipped or turned out to have
     * no audio. **A record marked `unavailable` is passed over here for the same reason a skipped
     * one is, and that is what makes a break promising it fail its claim check** rather than airing
     * a promise about a record the station has already given up on.
     *
     * `undefined` for a line the order does not hold, and for one with no record after it at all.
     * Both make a claim uncheckable, which the caller treats the same way it treats a broken one.
     */
    nextTrackAfter(itemId: string): StationLineupTrackItem | undefined {
        const at = this.itemList.findIndex(item => item.id === itemId);
        if (at < 0) return undefined;

        for (let index = at + 1; index < this.itemList.length; index++) {
            const item = this.itemList[index]!;
            if (item.kind === 'track' && item.state !== 'skipped' && item.state !== 'unavailable') return item;
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
        return { ...this.binding, broadcastId: this.broadcast, items: [...this.itemList] };
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
     * @returns what this did to the order, or `undefined` when the order does not hold the item —
     *   an id from a session before this process started, which must never be invented into the
     *   order. The COUNT is answered rather than kept, because the only caller that wants it is a
     *   report and this class holds no opinion about who is listening.
     */
    markAiring(itemId: string): AiringResult | undefined {
        const index = this.itemList.findIndex(item => item.id === itemId);
        if (index < 0) return undefined;

        const item = this.itemList[index]!;
        if (item.state === 'airing') return { passedOver: 0 };

        let passedOver = 0;
        for (const earlier of this.itemList.slice(0, index)) {
            if (earlier.state === 'airing') earlier.state = 'played';
            else if (earlier.state === 'handed' || earlier.state === 'planned') {
                earlier.state = 'skipped';
                passedOver += 1;
            }
        }
        item.state = 'airing';
        return { passedOver };
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
     * The station cannot get hold of this record's audio.
     *
     * Terminal for the same reason {@link markSkipped} is, and separate from it because an operator
     * can act on this one: nothing could resolve a URL, or every copy has been benched for failing
     * to serve. What they see is a record that did not air with the reason attached to it, instead
     * of one more yellow badge meaning any of four things.
     *
     * Takes a `handed` item too, because the transport discovers this at the moment it tries to
     * hand one over — the resolve is what fails — and by then the item is already claimed.
     */
    markUnavailable(itemId: string): boolean {
        return this.transition(itemId, 'planned', 'unavailable') || this.transition(itemId, 'handed', 'unavailable');
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

    /**
     * Point at somewhere else to pull more from, and relabel.
     *
     * It does NOT change {@link broadcastId}, and cannot: the broadcast is minted with the object.
     * Anything that means "a different programme is on now" builds a new running order rather than
     * rebinding this one, which is what `putOnAir` does.
     */
    rebind(binding: StationLineupBinding): void {
        this.binding = binding;
    }

    /**
     * Change what the operator has asked this broadcast to play.
     *
     * Narrow on purpose, where {@link rebind} takes the whole binding: the brief is the one part of
     * it that a broadcast can legitimately change its mind about mid-show. Everything else there
     * says which programme this IS, and a different answer to that is a different programme.
     *
     * **An empty brief clears it, and clearing means something.** A briefed station is programmed
     * against the words and is deliberately not shown the presenting persona's `music` line at all;
     * an unbriefed one is programmed by that line. So this is the switch between "play heavy metal
     * hits" and "play whatever the host would play", and both are things to ask for.
     */
    rebrief(brief?: string): void {
        const { brief: _current, ...rest } = this.binding;

        this.binding = brief ? { ...rest, brief } : rest;
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
    insertSegments(placements: readonly SegmentPlacement[]): EditResult {
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
                ...(placement.segmentKind === undefined ? {} : { segmentKind: placement.segmentKind }),
                ...(placement.over === undefined ? {} : { over: placement.over }),
                ...(placement.groupId === undefined ? {} : { groupId: placement.groupId }),
            });
        }
        return OK;
    }

    /**
     * Put a whole block of segments in at one position, in order, or put none of them in.
     *
     * What a production needs, and the difference from {@link insertSegments} is the word BLOCK.
     * That one takes placements at positions a caller computed independently — a refill's three
     * breaks scattered through fifteen records — and each is its own thing. This takes segments that
     * only mean anything together and lays them out contiguously from one index, tagged with a
     * shared {@link StationLineupSegmentItem.groupId} so nothing downstream can break them apart.
     *
     * **All or nothing.** A production with beat 4 missing is not a shorter production; it is a
     * programme with a hole in the middle, which is the exact opposite of the rule that governs an
     * ordinary break. That asymmetry is the same one `bytes-before-air.md` already argues when it
     * holds a cold record and skips a cold segment — a break is disposable and this is not.
     *
     * The block goes in AT `atIndex` and pushes everything from there back, so the records either
     * side keep their order. Refused whole if that position is already with the player.
     */
    insertGroup(groupId: string, segmentIds: readonly string[], atIndex: number, segmentKind?: string): EditResult {
        if (segmentIds.length === 0) return refuse('empty', 'there is nothing to put in');
        if (atIndex < this.committedThrough()) return refuse('already-aired', 'that position has already been handed to the player');

        // Built as one list and spliced once, rather than through `insertSegments`: that one applies
        // highest-index-first so independent placements do not drift, which is exactly wrong here.
        // These are contiguous and ordered, and beat 2 must land after beat 1.
        const index = Math.min(atIndex, this.itemList.length);
        this.itemList.splice(
            index,
            0,
            ...segmentIds.map(segmentId => ({
                id: randomUUID(),
                kind: 'segment' as const,
                state: 'planned' as const,
                segmentId,
                groupId,
                ...(segmentKind === undefined ? {} : { segmentKind }),
            })),
        );

        return OK;
    }

    /** Put one segment into the order at a position. */
    insertSegment(segmentId: string, atIndex: number, over?: { atMs: number }, segmentKind?: string): EditResult {
        return this.insertSegments([
            {
                segmentId,
                atIndex,
                ...(over === undefined ? {} : { over }),
                ...(segmentKind === undefined ? {} : { segmentKind }),
            },
        ]);
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

        if (item.kind !== 'segment') {
            this.itemList.splice(index, 1);
            return OK;
        }

        // A beat of a production takes the whole production with it. Cutting one beat out of a
        // programme does not leave a shorter programme, it leaves one that stops mid-sentence and
        // starts again — so an operator who deletes a beat has asked to drop the production, which
        // is the only thing that request can sensibly mean.
        //
        // Every member is MARKED rather than spliced, exactly as a lone break is, and for the same
        // reason: `BreakPlanner` counts records since the last segment already in the order, so a
        // spliced-out block leaves a gap it cannot tell from one never planted into and plants a
        // fresh break a boundary later. The mark ages out with the rest of the past.
        const group = item.groupId;
        if (group === undefined) {
            item.state = 'removed';
            return OK;
        }

        // Only what has not aired. A block half of which is already with the player is not something
        // an operator can un-broadcast, and marking those would rewrite what actually happened.
        for (const member of this.itemList) {
            if (member.kind === 'segment' && member.groupId === group && member.state === 'planned') member.state = 'removed';
        }
        return OK;
    }

    /**
     * Shuffle the records not yet committed, and drop the breaks planted among them.
     *
     * Only the tail, because the head is already in the player's hands. Refuses a tail with
     * fewer than two RECORDS in it rather than reporting a shuffle that could not have changed
     * anything: the breaks are not what is being reordered.
     *
     * **A break is not shuffled with the records, it is dropped and planted again.** A break sits
     * where it does because of what is on either side of it — an interval of records since the last
     * one, a link naming the record it introduces — and carrying it along to a random new position
     * keeps none of that: the spacing it was planted for is gone and the words, if they had been
     * written, are about two records it no longer sits between. So the planned segments come out
     * here and `BreakPlanner` plants the shuffled tail on the commit pass that follows, which is the
     * same shape {@link replacePlanned} leaves behind and for the same reason. The planner counts
     * records since the last segment ALREADY in the order, so a tail with no segments in it is
     * exactly the state it is built to plant into.
     *
     * @returns the items it dropped along with the outcome, because the caller has work to do on
     *   them: the segments among them own `deadair.segments` rows now describing a break that will
     *   never air.
     */
    shuffleRemaining(): ShuffleResult {
        const head = this.itemList.filter(item => item.state !== 'planned');
        const planned = this.itemList.filter(item => item.state === 'planned');
        const tail = planned.filter(isTrackItem);
        if (tail.length < 2) return { result: refuse('empty', 'there is nothing left to shuffle'), dropped: [] };

        for (let index = tail.length - 1; index > 0; index--) {
            const swap = Math.floor(Math.random() * (index + 1));
            [tail[index], tail[swap]] = [tail[swap]!, tail[index]!];
        }
        // The committed head keeps its own order and stays in front, which is the one
        // thing a shuffle must not touch: those items are already with the player.
        this.itemList = [...head, ...tail];
        return { result: OK, dropped: planned.filter(item => !isTrackItem(item)) };
    }

    /**
     * Throw the unplayed tail away and put these records in its place.
     *
     * What a REPLAN is, as against a shuffle: the same hour in a different sequence is still the
     * same hour, and an operator who dislikes what is coming wants different records rather than
     * different order. The alternative before this was putting the station on air again, which ends
     * the broadcast and files the rest of the night under a new one.
     *
     * Everything not `planned` keeps its place, which is the same line {@link shuffleRemaining}
     * draws and for the same reason: the head is in the player's hands, and the past is the record
     * of what happened. So `handed`, `airing`, `played`, `skipped`, `unavailable` and `removed` all
     * survive untouched and the new records go behind them.
     *
     * Planned SEGMENTS go too, and this is deliberately not {@link remove}'s asymmetry. A record is
     * spliced there and a break is left as a `removed` mark, because `BreakPlanner` counts records
     * since the last segment already in the order and could not otherwise tell an operator's cut
     * from a slot it never planted into. Here the whole tail goes at once, so what the planner walks
     * is a run of records with no segments in it — exactly the state it is built to plant into, and
     * exactly what it should do with a tail nobody has ever talked over.
     *
     * @returns the items it dropped, because the caller has work to do on them: the segments among
     *   them own `deadair.segments` rows that are now describing a break that will never air.
     */
    replacePlanned(tracks: readonly RundownTrack[]): StationLineupItem[] {
        const dropped = this.itemList.filter(item => item.state === 'planned');

        this.itemList = [...this.itemList.filter(item => item.state !== 'planned'), ...tracks.map(toItem)];
        return dropped;
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
