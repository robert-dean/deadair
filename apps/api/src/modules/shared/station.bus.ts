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
 * Only what something subscribes to, deliberately: the map used to open by counting its entries and
 * was wrong the day a third arrived, so it no longer counts. The station's other moments (a
 * departure, a silence cause changing) are one line each on the day something wants to react to one,
 * which is the same rule `Heartbeat` states for the loops that have not adopted it. A map full of
 * events nobody subscribes to would be a description of an intention rather than of this program.
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

    /**
     * An operator saved a plugin's settings.
     *
     * Not "the plugin was reinitialized" and not "the catalog sync was asked for" — those already run
     * off `PluginsService.updatePluginConfig` directly, in the same `afterCommit` hooks this rides
     * beside. This is for the subscriber on the other side of the module list that cannot be one of
     * those hooks without `plugins` importing it: enrichment, whose stored rows for this provider are
     * stale the moment its settings change, and which has no reason to know that `PluginsService`
     * exists.
     */
    'plugin.configured': { pluginId: string };

    /**
     * An operator told the station not to play something.
     *
     * The DISLIKE rather than the rating, which is the one arm of `catalog/rating.ts`'s three that
     * anything reacts to: a like changes how often a record is drawn and the draw reads that for
     * itself, where a dislike is an instruction that has to reach a running order already built. So
     * the publisher filters rather than the subscriber, unlike `plugin.configured` beside it —
     * `PluginsService` cannot know which saves matter to enrichment, and `ArtistsService` knows
     * exactly which of the three ratings this is.
     *
     * `level` and `id` say what was rated; `name` rides along so the subscriber can write the feed's
     * sentence without reading the row back. The subscriber is `DislikeVeto` in `director`, which is
     * registered after `catalog` and so cannot be reached directly — `StationIdentity`'s reason, and
     * this file's.
     *
     * Deliberately NOT the tracks it forbids. A dislike at any of the three levels vetoes through
     * `CandidatesRepository.effectiveRating`, guests included, and resolving that to a track list is
     * the director's question rather than the catalog's.
     */
    'catalog.disliked': { level: 'artist' | 'album' | 'track'; id: string; name: string };

    /**
     * The station went on air, or came off it.
     *
     * Published by the director beside the `air.on` and `air.off` lines it writes to the activity
     * feed, and at the same moments: after the durable write, so nothing hears of a change the
     * station itself does not believe. The subscriber is `events`, which tells an operator's own
     * servers, and which the director cannot reach because it is registered long after.
     *
     * `reason` says which way it happened: a new running order (`programme`, with its name when it
     * has one), the stopped one started again (`resumed`), somebody stopping it (`stopped`), or the
     * running order running out and saying to stop (`ranOut`). `at` is epoch milliseconds, taken
     * when the director decided, so a subscriber that does slow work still reports the right moment.
     */
    'air.changed': { on: boolean; reason: 'programme' | 'resumed' | 'stopped' | 'ranOut'; programme?: string; at: number };

    /**
     * The station started or stopped wanting its mount: a programme AND an audience, the two
     * halves `PlayoutPusher.wantsAir` asks for together before it renews the lease.
     *
     * Not `air.changed` beside it, which is the programme half alone. An audience-gated station
     * with a running order and nobody listening is `on` there and standing down here, and that is
     * the difference a plugin holding a speech model on a graphics card needs to see. The
     * audience half already waits out `AudienceWatch`'s linger window, so a listener dropping out
     * for a moment does not move this.
     *
     * Published by the pusher on the reconcile pass where the answer changed, so at most once a
     * tick, and once on the first pass whatever the answer is. The subscriber is `PluginAirState`
     * in `plugins`, which backs `host.air` and is registered long before `playout`. `at` is epoch
     * milliseconds, taken by the pass that noticed.
     */
    'air.wanted': { on: boolean; at: number };

    /**
     * The live input changed state: a presenter's encoder on `LIVE_PORT` (`stream/radio.liq`, "Live
     * input"). `state` is where it went and `previous` where it came from, as the audio chain
     * reports them (`off`, `armed`, `preroll`, `onair`).
     *
     * Published by `LiveActivity` in `playout`, on the control client's own edge, so once per change
     * and in order. The subscriber is `LiveHandOver` in `director`, which stands the station down
     * when the presenter takes the air and puts it back when they hand back, and which `playout`
     * cannot reach because it is registered after it. `at` is epoch milliseconds, taken when the
     * reading arrived.
     */
    'live.changed': { state: 'off' | 'armed' | 'preroll' | 'onair'; previous: 'off' | 'armed' | 'preroll' | 'onair'; at: number };

    /**
     * A listener asked for a record: from an app, the console, a party pass or a chat.
     *
     * Published by `RequestDesk.submit` once the row is written and, when it could be, placed, so
     * `status` is what the listener is told: `waiting` on an operator, `pending` on its audio,
     * `queued` in the running order, or `declined` with the `reason` they are given. A refusal is a
     * request received too. The subscriber is `events`, registered after `requests` and so out of
     * its reach. Not from `AfterCommit`, deliberately: nothing here is read back, and a request from a
     * chat is submitted in a scope no request middleware runs, where an after-commit task would never
     * run at all.
     *
     * `dedication` is the listener's own words, untrusted, carried because the operator's own
     * receiver may want them.
     */
    'request.received': {
        id: string;
        trackId: string;
        title: string;
        artist: string;
        requesterName: string;
        via: 'app' | 'chat';
        status: 'waiting' | 'pending' | 'queued' | 'aired' | 'declined' | 'expired';
        reason?: string;
        insisted?: true;
        dedication?: { to?: string; message?: string };
        at: number;
    };
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
