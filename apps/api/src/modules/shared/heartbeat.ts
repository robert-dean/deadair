/**
 * A record of which of the station's loops are still going round.
 *
 * ## The problem it solves
 *
 * Several things here are a `setInterval` that nothing awaits and nothing
 * supervises: the transport's reconcile, the audience poll, the config staleness
 * check, the job scheduler. Each one guards itself so a throw cannot wedge it,
 * which is right, and the consequence is that **a loop which has stopped looks
 * exactly like a loop with nothing to do**. Everything downstream keeps answering
 * from whatever that loop last wrote, confidently and forever.
 *
 * The transport is the case that costs something audible. `PlayoutControlClient`
 * sets `isUp` and `isOnAir` from the calls the reconcile pass makes, so a stopped
 * pass leaves both frozen at their last value: the console reports a station that
 * is on air while the mount lease quietly expires underneath it. Nothing else in
 * the reading accounts for that, and nothing else can.
 *
 * ## What it is
 *
 * A map of name to two timestamps, and nothing else. It is not a health check and
 * has no opinion about thresholds: **how long is too long is the reader's
 * question**, because a poll every five seconds and a nightly sweep are both
 * healthy and no single number describes them both. This answers how long it has
 * been, and whoever asked decides what that means.
 *
 * ```ts
 * start(): void {
 *     this.heartbeat.register('playout.reconcile');
 *     this.timer = setInterval(() => this.tick(), TICK_MS);
 * }
 * // ...and at the end of a completed pass:
 * this.heartbeat.beat('playout.reconcile');
 * ```
 *
 * A FAILURE is deliberately not recorded here. A loop that threw and carried on
 * is still alive, which is what this measures, and folding the two together would
 * mean a reader could not tell a loop that stopped from one that is failing every
 * pass — two different faults with two different fixes. Whatever cares about the
 * throw keeps it beside the loop.
 *
 * All in memory, and lost on restart, which is correct rather than a limitation:
 * a restart restarts every loop too, so there is nothing from before it that
 * would still be true.
 */

/** One loop's timestamps, as an answer for a reader that wants them all. */
export interface HeartbeatReading {
    name: string;
    /** When the loop said it was starting. */
    startedAt: number;
    /** When it last completed a pass, absent until it completes its first. */
    lastBeat?: number;
}

export class Heartbeat {
    private readonly loops = new Map<string, { startedAt: number; lastBeat?: number }>();

    /**
     * A loop is starting.
     *
     * What keeps boot from being a special case every reader has to know about.
     * Without it, a loop that has started and not yet finished its first pass is
     * indistinguishable from one that never started, so every caller would need a
     * grace window of its own and they would all pick a different one. With it,
     * {@link stalledFor} measures from the registration until the first beat lands
     * and the answer is meaningful from the first millisecond.
     *
     * Re-registering restarts the measurement and clears the last beat, because
     * that is what a loop stopped and started again actually is.
     */
    register(name: string, now = Date.now()): void {
        this.loops.set(name, { startedAt: now });
    }

    /**
     * A pass completed.
     *
     * Called at the END of a pass rather than the start: what a reader wants to
     * know is that work is coming round, and a loop that enters every pass and
     * never leaves one is the failure this is for.
     *
     * A beat for a name nobody registered registers it, so a loop that forgot the
     * call still reports honestly rather than silently never being watched.
     */
    beat(name: string, now = Date.now()): void {
        const loop = this.loops.get(name);
        if (loop) loop.lastBeat = now;
        else this.loops.set(name, { startedAt: now, lastBeat: now });
    }

    /**
     * How long this loop has gone without completing a pass, measured from its
     * last beat or, before there has been one, from when it registered.
     *
     * `undefined` for a name nothing ever registered or beat. That is deliberately
     * not zero and not infinity: nobody is watching that loop, which is a question
     * about this code rather than a fact about the station, and a reader that
     * turned it into a fault would report a missing call as a broken station.
     */
    stalledFor(name: string, now = Date.now()): number | undefined {
        const loop = this.loops.get(name);
        if (!loop) return undefined;

        return Math.max(0, now - (loop.lastBeat ?? loop.startedAt));
    }

    /** Every loop being watched. For a reader that wants to show all of them at once. */
    all(): HeartbeatReading[] {
        return [...this.loops.entries()].map(([name, loop]) => ({
            name,
            startedAt: loop.startedAt,
            ...(loop.lastBeat === undefined ? {} : { lastBeat: loop.lastBeat }),
        }));
    }

    /** A loop has stopped on purpose, so stop reporting on it. What a shutdown does. */
    forget(name: string): void {
        this.loops.delete(name);
    }
}

/**
 * The names in use, so a beat and the reader that judges it cannot drift apart
 * over a typo.
 *
 * Only the loops something actually reads. The rest of the intervals in the tree
 * can adopt this in one line each on the day a reader wants them; instrumenting
 * a loop nobody asks about would be a map that grows and is never looked at.
 */
export const HEARTBEATS = {
    /** The transport's reconcile pass: what renews the mount lease. */
    playoutReconcile: 'playout.reconcile',
    /** The Icecast listener poll. */
    audiencePoll: 'audience.poll',
    /**
     * The director asking again while the station is waiting on bytes.
     *
     * Unlike the two above it, this loop is idle by design: it posts a wake only while a commit
     * pass has found a running order it could not commit anything from. So a beat here says the
     * loop is alive and says nothing at all about whether the station is warming.
     */
    directorWarm: 'director.warm',
} as const;
