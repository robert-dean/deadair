import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { errorText } from './error.text.js';

/**
 * The station's moments, as they happen, for anything that wants to react to one.
 *
 * ## What it is for, and what it is deliberately not for
 *
 * This codebase prefers explicit lists to self-registration: `ToolRegistry` and `BreakWriterRegistry`
 * are both handed their members in one readable line, on the argument that what the station can do
 * should not be the sum of whatever happened to register itself. A bus is the opposite instinct, so
 * it earns its place on one thing only — **the direction of the dependency**.
 *
 * `AudienceWatch` knows that somebody tuned in. What the station DOES about that is a programming
 * decision, which belongs to the director, which is registered six modules later; a watch that
 * called the director would invert the module edge, and a watch that grew a subscriber list per
 * consumer would collect one per feature. So the watch publishes a fact and stops there. The same
 * shape is waiting for the next producer — a news poller, a scheduler — and each of them wants to
 * announce something rather than to know who is listening.
 *
 * It is the live sibling of `deadair.station_events`, which is the same set of moments written down.
 * Nothing here is persisted and nothing is replayed: a subscriber that was not listening missed it,
 * and the feed is where it is recorded.
 *
 * **The transport's own seams stay where they are.** `Rundown.onChange`, `onAired` and `onReset` are
 * hot, ordered couplings — the pusher's reset handler retracts before anything else touches the
 * queue, and `onAired` drives play history on the boundary. A bus flattens ordering and hides who
 * reacts, which is the right trade for an outside event with unknown subscribers and the wrong one
 * for the spine that keeps the station on air.
 *
 * It lives in `shared/` for `StationIdentity`'s reason: producers and subscribers sit on both sides
 * of the module list, so anything either of them imports has to import nothing itself.
 */

/**
 * Every kind of moment, and what it carries.
 *
 * One entry today, deliberately. The station's other moments — a departure, an air toggle, a silence
 * cause changing — are one line each on the day something wants to react to one, which is the same
 * rule `Heartbeat` states for the loops that have not adopted it. A map full of events nobody
 * subscribes to would be a description of an intention rather than of this program.
 */
export interface StationEvents {
    /**
     * Somebody tuned in to an empty room.
     *
     * The RAW count going from nothing to something, rather than the audience gate opening: in
     * `always` mode the gate never moves, and the linger window means `hasAudience()` is about
     * holding the mount rather than about anybody being there.
     */
    'audience.arrived': { count: number };
}

export type StationEventKind = keyof StationEvents;

@Injectable()
export class StationBus {
    private readonly subscribers = new Map<StationEventKind, Set<(event: never) => void>>();

    constructor(private readonly logger: Logger) {}

    /**
     * Say that something happened. Never throws.
     *
     * A subscriber that throws is logged and the others still run, which is the rule
     * `AudienceWatch.settle()` and `ActivityRecorder` already follow: nothing published here is
     * something the publisher is waiting on, so a failed handler must never cost the thing that
     * announced it. A poll loop that died because a greeting could not be requested would be a far
     * worse fault than the greeting.
     *
     * Synchronous fan-out, so a publisher's own stack frame is where a subscriber's decision is made.
     * A subscriber with slow work to do starts it and returns, exactly as every listener on
     * `Rundown` already does.
     */
    publish<K extends StationEventKind>(kind: K, event: StationEvents[K]): void {
        const listeners = this.subscribers.get(kind);
        if (listeners === undefined) return;

        for (const listener of listeners) {
            try {
                (listener as (event: StationEvents[K]) => void)(event);
            } catch (error) {
                this.logger.warn(`station: a subscriber threw on ${kind} (${errorText(error)})`);
            }
        }
    }

    /** Listen for one kind of moment. Returns the unsubscribe. */
    subscribe<K extends StationEventKind>(kind: K, listener: (event: StationEvents[K]) => void): () => void {
        const listeners = this.subscribers.get(kind) ?? new Set();
        this.subscribers.set(kind, listeners);
        listeners.add(listener as (event: never) => void);

        return () => listeners.delete(listener as (event: never) => void);
    }
}
