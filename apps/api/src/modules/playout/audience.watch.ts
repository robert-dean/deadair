import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { IcecastStatsClient } from '#modules/stream/icecast.stats.client.js';

/**
 * Who is listening, and whether that is enough to hold the mount.
 *
 * The station's audio costs something to produce — a provider fetch and a
 * download per track, on a rate-limited account — and producing it for an empty
 * mount is the one thing nobody benefits from. So the audience is a first-class
 * reading here rather than a statistic: it is polled, it is published to the
 * console and the public now-playing answer, and (once the gate is wired) it is
 * what the mount lease is renewed against.
 *
 * It POLLS, and the poll is the truth. Icecast can also push listener events,
 * and that push is worth having for the moment somebody tunes in — but a push
 * can be dropped, and a listener whose connection was yanked is only ever
 * noticed by asking. Same division as `POST /playout/aired` and
 * `/control/status`: the push beats the poll to the edge, the poll is what makes
 * a dropped push harmless.
 */

/** How often Icecast is asked. Cheap and local; the whole document is a few hundred bytes. */
const AUDIENCE_POLL_MS = 5_000;

/**
 * How long the last listener counts as still being there.
 *
 * A player reconnecting — a network blip, a phone changing radios, an operator
 * moving the console between tabs — drops to zero listeners for a second or two
 * and comes straight back. Cutting the mount on that reading and rebuilding it a
 * moment later is worse than airing a minute of music nobody heard, and the
 * rebuild is audible while the gap is not.
 */
const AUDIENCE_LINGER_MS = 60_000;

@Injectable()
export class AudienceWatch {
    private timer?: NodeJS.Timeout;
    /** The last count Icecast (or a push) reported. `undefined` before the first answer. */
    private count?: number;
    /** When the count was last non-zero, which is what {@link hasAudience} lingers on. */
    private lastHeardAt = 0;
    /** What {@link hasAudience} said at the previous evaluation, so an edge can be announced once. */
    private announced = false;
    private readonly listeners = new Set<(present: boolean) => void>();
    /** One poll at a time: a slow Icecast must not stack requests behind the interval. */
    private polling = false;

    constructor(
        private readonly stats: IcecastStatsClient,
        private readonly logger: Logger,
    ) {}

    /** Begin watching. Idempotent. */
    start(): void {
        if (this.timer) return;

        this.timer = setInterval(() => void this.poll(), AUDIENCE_POLL_MS);
        this.timer.unref?.();
        void this.poll();
        this.logger.info(`audience: watching ${this.stats.mountPath()} every ${AUDIENCE_POLL_MS}ms (linger ${AUDIENCE_LINGER_MS}ms)`);
    }

    /** Stop watching. The last reading is kept, and stops being refreshed. */
    stop(): void {
        if (this.timer) clearInterval(this.timer);
        this.timer = undefined;
        this.listeners.clear();
    }

    /**
     * How many clients are attached to the mount right now.
     *
     * Zero before the first reading, and zero for an Icecast that is not
     * answering: this is a number a console draws and a public route publishes,
     * and "unknown" is not something either can render. {@link hasAudience} is
     * where the distinction is actually made.
     */
    listenerCount(): number {
        return this.count ?? 0;
    }

    /**
     * Whether the station has an audience, INCLUDING the linger window.
     *
     * Not simply `listenerCount() > 0`: see {@link AUDIENCE_LINGER_MS}. A reading
     * that never arrived is not an audience — an app that cannot see Icecast has
     * no evidence anybody is there, and guessing yes would air a whole broadcast
     * on the strength of a failed request.
     */
    hasAudience(): boolean {
        if ((this.count ?? 0) > 0) return true;
        return this.lastHeardAt > 0 && Date.now() - this.lastHeardAt < AUDIENCE_LINGER_MS;
    }

    /**
     * Take a count from something other than the poll — Icecast's own listener
     * hooks, which land the moment a client connects rather than up to a poll
     * later.
     *
     * Deliberately a whole count and not a delta. A delta from a source that can
     * drop a message drifts, and it drifts in the direction that matters most
     * (a missed `remove` leaves the station airing to nobody); the poll would
     * correct it, but only after a minute of broadcasting to an empty mount.
     */
    report(count: number): void {
        this.accept(Math.max(0, Math.trunc(count)));
    }

    /**
     * Subscribe to the audience arriving or leaving. Returns the unsubscribe.
     *
     * Edges only, and after the linger window rather than on the raw count: the
     * subscriber is the thing that holds or hands back the mount, and it should
     * hear "there is an audience" and "there is no longer one", not every
     * fluctuation in between.
     */
    onChange(listener: (present: boolean) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /** One reading. Never throws: it runs off a timer with nobody to hand a rejection to. */
    private async poll(): Promise<void> {
        if (this.polling) return;
        this.polling = true;

        try {
            const listeners = await this.stats.listeners();
            // Icecast did not answer. The last reading stands and the linger window keeps
            // running, so a brief outage does not read as everybody leaving at once.
            if (listeners === undefined) {
                this.settle();
                return;
            }
            this.accept(listeners);
        } catch (error) {
            this.logger.warn(`audience: could not read the listener count (${message(error)})`);
        } finally {
            this.polling = false;
        }
    }

    /** Record a count from any source, and announce the edge it produced. */
    private accept(count: number): void {
        const before = this.count;
        this.count = count;
        if (count > 0) this.lastHeardAt = Date.now();

        if (before !== count) {
            this.logger.debug(`audience: ${count} listening on ${this.stats.mountPath()}`);
        }
        this.settle();
    }

    /**
     * Re-evaluate the gate and tell the subscribers if it moved.
     *
     * Called from the poll even when nothing was read, because the linger window
     * expires on the clock rather than on a reading: the fall from "an audience"
     * to "none" happens a minute after the last listener left, with no event of
     * its own to hang it on.
     */
    private settle(): void {
        const present = this.hasAudience();
        if (present === this.announced) return;
        this.announced = present;

        this.logger.info(
            present
                ? `audience: somebody is listening to ${this.stats.mountPath()}`
                : `audience: nobody has been listening to ${this.stats.mountPath()} for ${AUDIENCE_LINGER_MS}ms`,
        );
        for (const listener of this.listeners) {
            try {
                listener(present);
            } catch (error) {
                // A subscriber that throws must not stop the others hearing it, and must
                // not kill the poll loop that got here.
                this.logger.warn(`audience: a listener threw on the ${present ? 'arrive' : 'leave'} edge (${message(error)})`);
            }
        }
    }
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));
