import { randomUUID } from 'node:crypto';
import type { RundownTrack } from '#modules/playout/rundown.js';

/**
 * A lineup: the ordered plan of what the station means to air, and how far
 * through it this broadcast has got.
 *
 * The distinction from the {@link Rundown} is the whole reason both exist. The
 * rundown is the short window the PLAYER is holding — three or four items, in
 * memory, rebuilt in seconds after a restart. The lineup is the deep plan behind
 * it: durable, hundreds of items long, editable by an operator, and the thing a
 * daypart schedule will one day name. Only a few items of it are committed to
 * the rundown at a time, and the {@link cursor} is how far that has got.
 *
 * A plain class rather than an injectable, because it is one ROW and not one
 * service: several lineups exist, the console can load one that is not on air,
 * and the director holds a different instance from the one an edit is applied
 * to. A DI token would have to mean "the lineup", which is exactly the
 * assumption a schedule breaks. Durability is a seam ({@link LineupStore}), so
 * this stays testable with no container and no database.
 *
 * See `apps/api/data/migrations/0007_director.sql` for the vocabulary — `mode`
 * and `on_end` in particular, which decide what this class does at the end of
 * the list.
 */

/** What kind of programming a lineup is. Mirrors `lineups.mode`. */
export type LineupMode = 'rotation' | 'setlist' | 'feature';

/** What the station does when a lineup runs out. Mirrors `lineups.on_end`. */
export type LineupOnEnd = 'extend' | 'repeat' | 'resume' | 'rotation' | 'stop';

/**
 * One line of the plan.
 *
 * `id` is the lineup's own, minted here, and is NOT the rundown item id: the
 * same line committed twice (a setlist that wraps) is two rundown items and one
 * lineup item. It exists so an operator can move or remove a line by name rather
 * than by counting rows, which is the only thing that survives a concurrent
 * edit.
 */
export interface LineupItem {
    id: string;
    track: RundownTrack;
}

/** Per-lineup overrides of the station's defaults. Absent fields fall through. */
export interface LineupRules {
    /** Days a song is suppressed after airing. `0` disables the window. */
    repeatWindowDays?: number;
    /** Minutes an artist is suppressed after airing. `0` disables the cooldown. */
    artistCooldownMinutes?: number;
    /** Most tracks by one artist in a generated batch. `0` disables the cap. */
    maxPerArtist?: number;
    /** Whether the director may generate more when this runs short. */
    autoExtend?: boolean;
}

/** A lineup as it is stored: the row, without the broadcast position. */
export interface LineupSnapshot {
    id: string;
    name: string;
    mode: LineupMode;
    onEnd: LineupOnEnd;
    /** Who built it: `import` or `director`. */
    source: string;
    sourcePluginId?: string;
    sourcePlaylistId?: string;
    items: LineupItem[];
    revision: number;
    rules?: LineupRules;
}

/**
 * Where a lineup is kept, implemented by the repositories.
 *
 * The two saves are separate because the two things move at completely
 * different rates and live in different tables: the order changes when someone
 * edits it, while the cursor moves on every single item that goes to the player.
 * One combined save would rewrite a several-hundred-item jsonb document every
 * few minutes for the sake of one integer.
 */
export interface LineupStore {
    /** Persist the order. Called on an edit, an append, or a compaction. */
    saveItems(lineupId: string, items: readonly LineupItem[], revision: number): Promise<void>;
    /** Persist how far this broadcast has committed. Called on every take. */
    saveCursor(lineupId: string, cursor: number): Promise<void>;
}

/** Why an edit was refused, for a console that has to tell someone standing at the desk. */
export type EditRefusal = 'not-found' | 'already-aired' | 'stale-revision' | 'empty';

/** The outcome of an edit: it happened, or precisely why it did not. */
export type EditResult = { ok: true } | { ok: false; reason: EditRefusal; message: string };

const OK: EditResult = { ok: true };

const refuse = (reason: EditRefusal, message: string): EditResult => ({ ok: false, reason, message });

/**
 * Consumed items to tolerate before the played prefix is dropped.
 *
 * A rotation is appended to forever, so without this a station left running for
 * a week accumulates thousands of dead lines in one jsonb document. Dropping the
 * prefix shifts every index behind it, so it happens in occasional batches
 * rather than per item.
 *
 * Never for a `setlist`, which wraps back to the top and would be compacting
 * away the very lines it is about to play again.
 */
const COMPACT_AT = 30;

export class Lineup {
    private itemList: LineupItem[];
    private cursorIndex: number;
    private revisionNo: number;
    private store?: LineupStore;

    constructor(
        private readonly snapshot: Omit<LineupSnapshot, 'items' | 'revision'>,
        items: LineupItem[] = [],
        revision = 0,
        cursor = 0,
    ) {
        this.itemList = items;
        this.revisionNo = revision;
        this.cursorIndex = Math.min(Math.max(0, cursor), items.length);
    }

    /** Bind durable storage. Without one this is process memory and nothing else. */
    bindStore(store: LineupStore | undefined): void {
        this.store = store;
    }

    // ── identity ───────────────────────────────────────────────────────────────

    get id(): string {
        return this.snapshot.id;
    }

    get name(): string {
        return this.snapshot.name;
    }

    get mode(): LineupMode {
        return this.snapshot.mode;
    }

    get onEnd(): LineupOnEnd {
        return this.snapshot.onEnd;
    }

    /** Who built it: `import` or `director`. Recorded against everything it airs. */
    get source(): string {
        return this.snapshot.source;
    }

    get rules(): LineupRules {
        return this.snapshot.rules ?? {};
    }

    // ── reading ────────────────────────────────────────────────────────────────

    /** The whole order, including the part already committed. */
    all(): readonly LineupItem[] {
        return this.itemList;
    }

    /** Everything from the cursor on: what has NOT been committed to the rundown yet. */
    upcoming(): readonly LineupItem[] {
        return this.itemList.slice(this.cursorIndex);
    }

    /**
     * How many items are left before this lineup runs out.
     *
     * The director's refill trigger. A `setlist` answers with what is left before
     * it wraps rather than infinity, because the number is only ever compared
     * against a threshold and a lineup that wraps never asks for more anyway.
     */
    remaining(): number {
        return Math.max(0, this.itemList.length - this.cursorIndex);
    }

    size(): number {
        return this.itemList.length;
    }

    cursor(): number {
        return this.cursorIndex;
    }

    revision(): number {
        return this.revisionNo;
    }

    isEmpty(): boolean {
        return this.itemList.length === 0;
    }

    /** Whether the cursor has reached the end and there is nothing left to commit. */
    isExhausted(): boolean {
        return this.cursorIndex >= this.itemList.length;
    }

    /** The row as it should be stored, for a caller that has to write it somewhere else. */
    toSnapshot(): LineupSnapshot {
        return { ...this.snapshot, items: [...this.itemList], revision: this.revisionNo };
    }

    // ── committing ─────────────────────────────────────────────────────────────

    /**
     * Take the next `count` items and advance the cursor past them.
     *
     * The one write the director makes on the hot path, and deliberately the only
     * one that moves the cursor: an item is committed when it is handed to the
     * rundown, not when it airs. The rundown is what tracks the difference
     * between those two, and duplicating that here would give the station two
     * disagreeing opinions about what is next.
     *
     * A `setlist` wraps to the top rather than running out, which is what makes
     * a Christmas list play across a month. Everything else stops, and the
     * director reads {@link onEnd} to decide what happens then.
     */
    async takeNext(count: number): Promise<LineupItem[]> {
        if (count <= 0 || this.itemList.length === 0) return [];

        const taken: LineupItem[] = [];
        while (taken.length < count) {
            if (this.cursorIndex >= this.itemList.length) {
                if (this.mode !== 'setlist') break;
                // Wrapped. Compaction is skipped for this mode precisely so the whole
                // list is still here to play again.
                this.cursorIndex = 0;
            }
            taken.push(this.itemList[this.cursorIndex]!);
            this.cursorIndex += 1;
        }

        if (taken.length > 0) {
            await this.compactIfNeeded();
            await this.store?.saveCursor(this.id, this.cursorIndex);
        }
        return taken;
    }

    // ── editing ────────────────────────────────────────────────────────────────

    /**
     * Replace the whole order, and start again from the top.
     *
     * Resets the cursor, because the items it counted are gone: leaving it where
     * it was would silently skip the head of the new list.
     */
    async replace(tracks: readonly RundownTrack[]): Promise<void> {
        this.itemList = tracks.map(toItem);
        this.cursorIndex = 0;
        await this.commitOrder();
        await this.store?.saveCursor(this.id, 0);
    }

    /** Add to the end. The cursor does not move: this is the plan continuing. */
    async append(tracks: readonly RundownTrack[]): Promise<LineupItem[]> {
        if (tracks.length === 0) return [];

        const added = tracks.map(toItem);
        this.itemList.push(...added);
        await this.commitOrder();
        return added;
    }

    /**
     * Move a line to a new position among the ones not yet committed.
     *
     * `toIndex` is absolute, so a console can send back the index it drew. An
     * index at or before the cursor is refused rather than clamped: the operator
     * is asking to reorder something a listener is about to hear, and quietly
     * doing something else instead is worse than saying no.
     */
    async move(itemId: string, toIndex: number, revision?: number): Promise<EditResult> {
        const stale = this.checkRevision(revision);
        if (stale) return stale;

        const from = this.itemList.findIndex(item => item.id === itemId);
        if (from < 0) return refuse('not-found', 'that line is not in this lineup');
        if (from < this.cursorIndex) return refuse('already-aired', 'that line has already been handed to the player');
        if (toIndex < this.cursorIndex) return refuse('already-aired', 'that position has already been handed to the player');

        const [item] = this.itemList.splice(from, 1);
        this.itemList.splice(Math.min(toIndex, this.itemList.length), 0, item!);
        await this.commitOrder();
        return OK;
    }

    /** Drop a line that has not been committed yet. */
    async remove(itemId: string, revision?: number): Promise<EditResult> {
        const stale = this.checkRevision(revision);
        if (stale) return stale;

        const index = this.itemList.findIndex(item => item.id === itemId);
        if (index < 0) return refuse('not-found', 'that line is not in this lineup');
        if (index < this.cursorIndex) return refuse('already-aired', 'that line has already been handed to the player');

        this.itemList.splice(index, 1);
        await this.commitOrder();
        return OK;
    }

    /**
     * Shuffle everything not yet committed.
     *
     * Only the tail, because the head is already in the player's hands. Refuses
     * an empty tail rather than reporting a shuffle that could not have changed
     * anything.
     */
    async shuffleRemaining(revision?: number): Promise<EditResult> {
        const stale = this.checkRevision(revision);
        if (stale) return stale;

        const tail = this.itemList.slice(this.cursorIndex);
        if (tail.length < 2) return refuse('empty', 'there is nothing left to shuffle');

        for (let index = tail.length - 1; index > 0; index--) {
            const swap = Math.floor(Math.random() * (index + 1));
            [tail[index], tail[swap]] = [tail[swap]!, tail[index]!];
        }
        this.itemList = [...this.itemList.slice(0, this.cursorIndex), ...tail];
        await this.commitOrder();
        return OK;
    }

    /** Empty it. What is already on air is the rundown's business, not this one's. */
    async clear(): Promise<void> {
        this.itemList = [];
        this.cursorIndex = 0;
        await this.commitOrder();
        await this.store?.saveCursor(this.id, 0);
    }

    /** Start this lineup again from the top: what `on_end: 'repeat'` does. */
    async rewind(): Promise<void> {
        this.cursorIndex = 0;
        await this.store?.saveCursor(this.id, 0);
    }

    // ── internals ──────────────────────────────────────────────────────────────

    /**
     * Refuse an edit made against a view of the order that has since moved.
     *
     * The console draws a list and the operator acts on what they can see. If the
     * director has appended, or another operator has reordered, the index the
     * console is holding no longer means what it meant — so the edit is refused
     * and the console re-reads, rather than being applied to whatever happens to
     * be in that position now.
     *
     * Omitting the revision is allowed and skips the check: the director's own
     * writes are not racing anyone.
     */
    private checkRevision(revision?: number): EditResult | undefined {
        if (revision === undefined || revision === this.revisionNo) return undefined;
        return refuse('stale-revision', 'the lineup changed since you last read it; re-read it and try again');
    }

    /** Bump the revision and persist the order. Every write to the ORDER goes through here. */
    private async commitOrder(): Promise<void> {
        this.revisionNo += 1;
        await this.store?.saveItems(this.id, this.itemList, this.revisionNo);
    }

    /**
     * Drop the consumed prefix once enough of it has built up.
     *
     * Not for a `setlist`: it wraps back to the top, so the prefix is not history
     * at all. Deliberately does NOT bump the revision — nothing about the plan
     * changed, only how much of the past is still being carried, and bumping
     * would invalidate a console's in-flight edit for a housekeeping detail.
     */
    private async compactIfNeeded(): Promise<void> {
        if (this.mode === 'setlist' || this.cursorIndex < COMPACT_AT) return;

        this.itemList = this.itemList.slice(this.cursorIndex);
        this.cursorIndex = 0;
        await this.store?.saveItems(this.id, this.itemList, this.revisionNo);
    }
}

const toItem = (track: RundownTrack): LineupItem => ({ id: randomUUID(), track });
