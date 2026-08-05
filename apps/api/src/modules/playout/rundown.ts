import { randomUUID } from 'node:crypto';
import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import type { QueueStatus } from './liquidsoap.control.js';
import { TrackResolver } from './playout.capability.js';

/**
 * The station's running order: what deadair has committed to playing, in order.
 *
 * The distinction the whole class is built around is that **handing an item to
 * the player is not the same as it airing**. Liquidsoap resolves (and, for an
 * http uri, downloads) the next request while the previous one is still playing,
 * so at any moment one item is on air and one is already fetched behind it. An
 * app that treats "just handed over" as "now playing" is a full item ahead of
 * the listener, which is wrong for now-playing, for play history, and for
 * anything that ever needs to time a DJ break.
 *
 * So an item moves `queue` -> `served` -> `airing`, and only the player can
 * perform the last step: either by the `on_track` notify ({@link markAired}) or
 * by a reading of its queue ({@link reconcile}).
 *
 * In memory only. A restart loses the running order and the operator presses
 * play again; the player keeps airing what it already holds in the meantime.
 * The previous incarnation persisted this, which mattered because a break's
 * timing hung off being able to name what was on air across a restart. Nothing
 * here schedules against the playhead yet, so that cost is not worth paying.
 */

export interface RundownItem {
    /** Ours, not the provider's: the id that rides through Liquidsoap on the annotation. */
    id: string;
    /**
     * Identity is `pluginId` + `externalId`, which is deliberately the key of
     * `deadair.track_sources (plugin_id, external_id)` — so what aired can be
     * joined back to a canonical catalog track without reshaping the item.
     */
    pluginId: string;
    externalId: string;
    title: string;
    artists: string[];
    durationMs?: number;
}

/** An item handed over, with the URL the player was told to fetch. */
export interface PulledItem {
    item: RundownItem;
    url: string;
}

/**
 * An item the player has been given, and when.
 *
 * The timestamp exists for one reason: a pushed request is INVISIBLE for a while.
 * Liquidsoap pops it off the queue to resolve it — for an http uri, to download
 * the whole track — and during that window it is neither counted in `queued` nor
 * reported as `onAir`. A reconcile that read that gap as a lost push would hand
 * the same item over twice, and the listener would hear the track played twice.
 * See {@link RESOLVE_GRACE_MS}.
 */
interface ServedItem {
    item: RundownItem;
    /** Epoch millis when it was handed to the player. */
    servedAt: number;
}

/**
 * How long a handed-over item may be unaccounted for before the rundown believes
 * the push was lost.
 *
 * Generous on purpose, because the two ways of being wrong are not symmetrical.
 * Too short and an item still downloading is re-queued and airs twice, which is
 * audible and wrong. Too long and a genuinely lost push is recovered a few
 * seconds late — during which the item on air is still playing, so nothing is
 * heard at all. A Spotify track comes through the shim, which decrypts it from
 * the CDN, so seconds rather than milliseconds is the normal case.
 */
const RESOLVE_GRACE_MS = 15_000;

/** What is on air, as far as the player has told us. */
export interface NowPlaying {
    item: RundownItem;
    /** Epoch millis when it went on air, as observed here. */
    startedAt: number;
    /**
     * Milliseconds left, when the decoder last said. Taken at face value and
     * only ever displayed: nothing schedules against it, which is what makes a
     * jumpy reading cosmetic here rather than something that could take a track
     * off air early.
     */
    remainingMs?: number;
}

/** The fields of a rundown item that come from a plugin's catalog. */
export type RundownTrack = Omit<RundownItem, 'id'>;

/**
 * The airing item as held internally: the same thing plus when the playhead was
 * last measured, which is what {@link Rundown.nowPlaying} projects from. Kept off
 * the public shape because it is bookkeeping, not an answer.
 */
type AiringItem = NowPlaying & { observedAt: number };

@Injectable()
export class Rundown {
    /** Committed but not yet handed to the player. */
    private queue: RundownItem[] = [];
    /** Handed to the player, not yet confirmed on air. In hand-over order. */
    private served: ServedItem[] = [];
    /** Confirmed on air by the player. */
    private airing?: AiringItem;
    /** The last unexplainable id the player named, so it is reported once rather than every tick. */
    private unknownOnAir?: string;

    private readonly changeListeners = new Set<() => void>();
    private readonly resetListeners = new Set<(standingDown: boolean) => void>();

    constructor(
        private readonly resolver: TrackResolver,
        private readonly logger: Logger,
    ) {}

    /**
     * Replace the running order.
     *
     * Everything already handed over is given up on, which is what makes this a
     * reset rather than an append: the pusher's reset listener flushes the
     * player's queue so it stops playing an order the station has abandoned.
     * What is on air finishes — a new running order is not a reason to cut the
     * listener off mid-track.
     */
    load(tracks: readonly RundownTrack[]): void {
        this.queue = tracks.map(track => ({ ...track, id: randomUUID() }));
        this.served = [];
        // Not a stand-down: the station is still on air, playing the item it was
        // already playing, and only the order behind it has changed.
        this.announceReset(false);
        this.emit();
    }

    /**
     * Stop: drop the running order entirely, including whatever was on air.
     *
     * The airing item goes too, which is what makes this a stand-down rather than
     * a change of plan. deadair holds the mount only while it has a programme
     * ({@link hasProgramme}), so leaving `airing` set would have the station
     * asserting control of a track it has just abandoned, and the audio would
     * outlive the command by a whole item.
     */
    reset(): void {
        this.queue = [];
        this.served = [];
        this.airing = undefined;
        this.announceReset(true);
        this.emit();
    }

    /**
     * Whether the station currently has anything it is responsible for airing.
     *
     * This is the question the dead-man switch is answered with: deadair holds
     * the mount while this is true and hands it back when it is not, so an app
     * that is merely RUNNING does not keep a station on air with nothing to play.
     * An empty rundown after a restart is exactly that case.
     */
    hasProgramme(): boolean {
        return this.airing !== undefined || this.served.length > 0 || this.queue.length > 0;
    }

    /**
     * Everything committed but not yet on air, in the order it will air.
     *
     * What the player is already HOLDING comes first. That item is the genuinely
     * next one — it has been handed over and, for an http uri, downloaded — and
     * leaving it out is how a console ends up naming the track after next as
     * "next". It is not in {@link queue} precisely because it has moved on, so
     * the two lists have to be answered together or the answer is wrong by one.
     */
    upcoming(): readonly RundownItem[] {
        return [...this.served.map(entry => entry.item), ...this.queue];
    }

    /**
     * How many items are waiting HERE, which is a smaller number than
     * {@link upcoming} by whatever the player is holding.
     *
     * The pusher's own bookkeeping, not an answer for a console: it is what
     * {@link reconcileServed} compares a reading against.
     */
    queuedCount(): number {
        return this.queue.length;
    }

    /**
     * What is on air, with the playhead projected from the last reading. Projected
     * on read rather than on a timer, so it is never served stale and nothing
     * pulses through the listeners every couple of seconds.
     */
    nowPlaying(): NowPlaying | undefined {
        if (!this.airing) return undefined;

        const { item, startedAt, remainingMs, observedAt } = this.airing;
        if (remainingMs === undefined) return { item, startedAt };
        return { item, startedAt, remainingMs: Math.max(0, remainingMs - (Date.now() - observedAt)) };
    }

    /**
     * Hand the next item over: resolve a URL for it and move it to `served`.
     * Returns `undefined` when nothing is left, at which point the player drains
     * and the mount falls back to the local bed.
     *
     * Skips, rather than stalls on, an item it cannot resolve. A track whose
     * plugin is disabled or whose upstream is refusing is one track; silence is
     * the whole station.
     */
    async next(): Promise<PulledItem | undefined> {
        while (this.queue.length > 0) {
            const item = this.queue.shift()!;
            const url = await this.resolver.resolve(item);
            if (!url) {
                this.logger.warn(`rundown: cannot resolve '${item.title}' (${item.pluginId}:${item.externalId}) — skipping it`);
                continue;
            }
            this.served.push({ item, servedAt: Date.now() });
            this.emit();
            return { item, url };
        }
        this.emit();
        return undefined;
    }

    /**
     * Put a handed-over item back at the head of the queue.
     *
     * For a push that did not land: nothing aired, so the next pass should offer
     * the same thing again rather than lose it.
     */
    unserve(id: string): boolean {
        const index = this.served.findIndex(entry => entry.item.id === id);
        if (index < 0) return false;

        const [entry] = this.served.splice(index, 1);
        this.queue.unshift(entry!.item);
        this.emit();
        return true;
    }

    /**
     * The player says this item started. Anything handed over before it was
     * skipped — a failed decode, an operator skip — so those come off `served`
     * with it.
     *
     * Returns false for an id we never served, which is how a stale notify from
     * a previous session is ignored rather than invented into the running order.
     */
    markAired(id: string): boolean {
        if (this.airing?.item.id === id) return true;

        const index = this.served.findIndex(entry => entry.item.id === id);
        if (index < 0) return false;

        const consumed = this.served.splice(0, index + 1);
        this.setAiring(consumed[consumed.length - 1]!.item);
        this.emit();
        return true;
    }

    /**
     * Take one reading of the player and make it the truth.
     *
     * The counterpart to {@link markAired}: the notify is a push, so it reacts on
     * the boundary itself, while this is a pull on the pusher's loop. That is
     * what makes the cases a notify cannot cover recoverable — a dropped notify,
     * an item ENDING with nothing behind it (which no boundary announces), a
     * Liquidsoap restart that silently forgot everything handed to it, and a
     * queue shallower than we think we filled.
     *
     * Believes nothing unless `ready` is present: that field only exists in the
     * radio.liq that reports the rest of the reading, so its absence means the
     * container is on an older script and there is nothing here to trust.
     */
    reconcile(reading: QueueStatus): void {
        if (reading.ready === undefined) return;

        // Whether the reading names an item this process can speak for. False is the
        // one thing the reading is certain about: whatever we still hold is NOT on air.
        const named = reading.onAir === undefined || this.observeOnAir(reading.onAir);

        if (!reading.ready || !named) {
            this.retireAiring();
        } else if (reading.remainingMs !== undefined && this.airing) {
            this.airing.remainingMs = reading.remainingMs;
            this.airing.observedAt = Date.now();
        }

        this.reconcileServed(reading.queued);
    }

    /** Subscribe to running-order changes. Returns the unsubscribe. */
    onChange(listener: () => void): () => void {
        this.changeListeners.add(listener);
        return () => this.changeListeners.delete(listener);
    }

    /**
     * Subscribe to the order being replaced or dropped. Returns the unsubscribe.
     *
     * `standingDown` tells the two apart, and they are not the same command: a
     * replacement keeps the station on air and only retracts what has not been
     * heard yet, while a stand-down ends the broadcast. Only the second one is
     * allowed to cut a listener off mid-track.
     */
    onReset(listener: (standingDown: boolean) => void): () => void {
        this.resetListeners.add(listener);
        return () => this.resetListeners.delete(listener);
    }

    /**
     * Reconcile what the player is holding against what we think we handed it.
     *
     * `queued` excludes the item on air, so it is exactly `served.length` when
     * everything landed. Fewer means a push went missing (or Liquidsoap
     * restarted), and those items are re-queued at the head rather than left
     * believed-delivered — the alternative is a running order that quietly skips
     * them. The tail is what goes back, because the player consumes from the
     * front.
     *
     * EXCEPT while an item is still being resolved. Liquidsoap takes a pushed
     * request off the queue to fetch it, and until the first frame plays it is in
     * neither `queued` nor `onAir` — so a short reading is the NORMAL state for
     * the seconds it takes to download a track, not evidence of anything. Acting
     * on it hands the same item over a second time and the listener hears the
     * track twice. Only an item that has been unaccounted for longer than
     * {@link RESOLVE_GRACE_MS} is treated as lost.
     */
    private reconcileServed(queued: number): void {
        if (queued >= this.served.length) return;

        // The player consumes from the front, so the first `queued` are the ones it
        // is accounted for holding; everything past that is what has gone missing.
        const handed = this.served.length;
        const settledBy = Date.now() - RESOLVE_GRACE_MS;

        const keep: ServedItem[] = [];
        const lost: RundownItem[] = [];
        this.served.forEach((entry, index) => {
            if (index >= queued && entry.servedAt <= settledBy) lost.push(entry.item);
            else keep.push(entry);
        });

        // Everything short is still within its grace: the player is fetching, which
        // is the overwhelmingly common reason for a reading to be short at all.
        if (lost.length === 0) return;

        this.served = keep;
        this.queue.unshift(...lost);
        this.logger.warn(`rundown: the player never took ${lost.length} of ${handed} handed over; re-queued ${lost.length}`);
        this.emit();
    }

    /**
     * The player named the item it is playing. Almost always one we already
     * believe is on air, because the notify beat this here by a tick.
     *
     * An id we never served belongs to a session before this process started — a
     * Liquidsoap that outlived an app restart. There is nothing truthful to say
     * about it, so it is never invented into the running order; it is reported
     * once and the clock stands down.
     */
    private observeOnAir(id: string): boolean {
        if (this.airing?.item.id === id) return true;
        if (this.markAired(id)) {
            this.unknownOnAir = undefined;
            return true;
        }
        if (this.unknownOnAir !== id) {
            this.unknownOnAir = id;
            this.logger.warn(`rundown: the player is airing item ${id}, which this process never handed it — standing the clock down`);
        }
        return false;
    }

    private setAiring(item: RundownItem): void {
        this.airing = { item, startedAt: Date.now(), observedAt: Date.now() };
        this.unknownOnAir = undefined;
    }

    /** Take the airing item off air: the player says it is not producing it. */
    private retireAiring(): void {
        if (!this.airing) return;
        this.airing = undefined;
        this.emit();
    }

    private emit(): void {
        for (const listener of this.changeListeners) listener();
    }

    private announceReset(standingDown: boolean): void {
        for (const listener of this.resetListeners) listener(standingDown);
    }
}
