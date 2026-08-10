import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { IcecastStatsClient } from '#modules/stream/icecast.stats.client.js';
import { IcecastEventFeed } from '#modules/stream/icecast.eventfeed.client.js';
import { AIR_MODE_KEY, parseAirMode, type AirMode } from './air.mode.js';

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
 * noticed by asking. Same division as `POST /playout/bridge/aired` and
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

/**
 * How long after a pushed listener event to take a real reading.
 *
 * Long enough for Icecast to have finished admitting (or releasing) the client
 * whose event this was, so the document it answers with already counts them.
 * Short enough that the guess the push produced is never the number for long.
 */
const PUSH_SETTLE_MS = 1_000;

@Injectable()
export class AudienceWatch {
    private timer?: NodeJS.Timeout;
    /** The last count Icecast (or a push) reported. `undefined` before the first answer. */
    private count?: number;
    /** When the count was last non-zero, which is what {@link hasAudience} lingers on. */
    private lastHeardAt = 0;
    /** What {@link hasAudience} said at the previous evaluation, so an edge can be announced once. */
    private announced = false;
    private readonly listeners = new Set<(open: boolean) => void>();
    /** One poll at a time: a slow Icecast must not stack requests behind the interval. */
    private polling = false;
    /** A reading brought forward by a push. Coalesced; see {@link refreshSoon}. */
    private refresh?: NodeJS.Timeout;

    constructor(
        private readonly stats: IcecastStatsClient,
        private readonly feed: IcecastEventFeed,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    /**
     * What the audience is allowed to decide, as the setting currently stands.
     *
     * Read here rather than pushed in. `deadair.settings` is a layer of the app's
     * config, so a settings row reaches this singleton the same way an
     * environment variable does — which it could not when the only way in was the
     * scoped repository, and this class polls off a timer with no request scope of
     * its own.
     *
     * An unset or unrecognised value falls back rather than throwing; see
     * {@link parseAirMode} for why that is the safe direction here.
     */
    private get mode(): AirMode {
        return parseAirMode(this.config.get(AIR_MODE_KEY, ''));
    }

    /** Begin watching. Idempotent. */
    start(): void {
        if (this.timer) return;

        this.timer = setInterval(() => void this.poll(), AUDIENCE_POLL_MS);
        this.timer.unref?.();
        void this.poll();
        // The push half, where Icecast is new enough to offer one. It hands over whole
        // counts, which is why it can feed `report` directly: a message that never
        // arrives costs the edge, never the number.
        this.feed.watch(this.stats.mountPath(), count => this.report(count));
        this.logger.info(`audience: watching ${this.stats.mountPath()} every ${AUDIENCE_POLL_MS}ms (linger ${AUDIENCE_LINGER_MS}ms)`);
    }

    /** Stop watching. The last reading is kept, and stops being refreshed. */
    stop(): void {
        this.feed.stop();
        if (this.timer) clearInterval(this.timer);
        this.timer = undefined;
        if (this.refresh) clearTimeout(this.refresh);
        this.refresh = undefined;
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
     * Whether the mount lease may be renewed at all: the audience gate.
     *
     * The station's second condition, and the one this class exists for. The
     * first is having a programme to air, which is the rundown's to answer;
     * `PlayoutPusher` needs both to be true, and asks each of them for its own.
     */
    gateOpen(): boolean {
        return this.mode === 'always' || this.hasAudience();
    }

    /**
     * Take a count from something other than the poll.
     *
     * The whole count, never a delta: a delta from a source that can drop a
     * message drifts, and it drifts in the direction that matters most, because a
     * missed departure leaves the station airing to nobody.
     */
    report(count: number): void {
        this.accept(Math.max(0, Math.trunc(count)));
    }

    /**
     * Icecast has just admitted a listener, or let one go.
     *
     * This is the push half, and it exists for one moment only: the arrival. A
     * poll is up to {@link AUDIENCE_POLL_MS} behind, and those are seconds of
     * silence for somebody who has just tuned in. So an arrival is applied
     * OPTIMISTICALLY, which opens the gate on the instant, and a fresh reading is
     * taken a moment later to replace the guess with Icecast's own number.
     *
     * Optimistic is safe here in a way it would not be for a departure. Guessing
     * one listener too many airs a station for a second longer than it had to;
     * guessing one too few takes a mount away from somebody who is listening. The
     * departure is applied the same way only because the linger window means
     * nothing acts on it for a minute, by which time the poll has corrected it.
     *
     * NB an arrival is reported while Icecast is still holding the client's
     * connection open waiting for this answer, so the listener is NOT in its
     * stats yet: a poll here would read the old number, which is exactly why this
     * counts rather than asks.
     */
    noteArrival(arrived: boolean): void {
        this.accept(this.listenerCount() + (arrived ? 1 : -1));
        this.refreshSoon();
    }

    /**
     * Subscribe to the gate opening or closing. Returns the unsubscribe.
     *
     * Edges only, and on {@link gateOpen} rather than the raw count: the
     * subscriber is the thing that holds the mount, and it should hear "the
     * station may air now" and "it may not", not every fluctuation in a number.
     * That also means a mode change announces itself, which is what makes
     * switching to `always` take effect at once.
     */
    onChange(listener: (open: boolean) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /**
     * Take a reading shortly, rather than at the next interval.
     *
     * Coalesced, because a burst of arrivals is one thing to check: a station
     * announced somewhere gets a dozen connections in a second, and each of them
     * asking Icecast for the same document would be a dozen requests for one
     * answer.
     */
    private refreshSoon(): void {
        if (this.refresh || !this.timer) return;

        this.refresh = setTimeout(() => {
            this.refresh = undefined;
            void this.poll();
        }, PUSH_SETTLE_MS);
        this.refresh.unref?.();
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

    /**
     * Record a count from any source, and announce the edge it produced.
     *
     * Clamped at zero, because the push path counts rather than asks: a departure
     * for a listener this process never saw arrive (an app started after them, an
     * event whose partner was dropped) would otherwise take the reading negative,
     * and the linger window would then never expire against it.
     */
    private accept(count: number): void {
        const before = this.count;
        this.count = Math.max(0, count);
        if (this.count > 0) this.lastHeardAt = Date.now();

        if (before !== this.count) {
            this.logger.debug(`audience: ${this.count} listening on ${this.stats.mountPath()}`);
        }
        this.settle();
    }

    /**
     * Re-evaluate the gate and tell the subscribers if it moved.
     *
     * Called from the poll even when nothing was read, because two of the things
     * that move this gate arrive with no event of their own to hang them on. The
     * linger window expires on the clock, so the fall from "an audience" to "none"
     * happens a minute after the last listener left. And {@link mode} is read from
     * the config at the moment it is asked, so an operator switching to `always`
     * is noticed here, within one poll, rather than announced by the write.
     */
    private settle(): void {
        const open = this.gateOpen();
        if (open === this.announced) return;
        this.announced = open;

        this.logger.info(
            open
                ? `audience: the station may air (${this.mode === 'always' ? 'always on' : `somebody is listening to ${this.stats.mountPath()}`})`
                : `audience: nobody has been listening to ${this.stats.mountPath()} for ${AUDIENCE_LINGER_MS}ms; the station stops airing`,
        );
        for (const listener of this.listeners) {
            try {
                listener(open);
            } catch (error) {
                // A subscriber that throws must not stop the others hearing it, and must
                // not kill the poll loop that got here.
                this.logger.warn(`audience: a listener threw on the ${open ? 'open' : 'close'} edge (${message(error)})`);
            }
        }
    }
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));
