import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { IcecastStatsClient } from '#modules/stream/icecast.stats.client.js';
import { IcecastEventFeed } from '#modules/stream/icecast.eventfeed.client.js';
import { HlsAudience } from '#modules/stream/hls.audience.js';
import { Heartbeat, HEARTBEATS } from '#modules/shared/heartbeat.js';
import { StationBus } from '#modules/shared/station.bus.js';
import { AIR_MODE_KEY, parseAirMode, type AirMode } from './air.mode.js';
import { errorText } from '#modules/shared/error.text.js';

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

/**
 * How often Icecast is asked.
 *
 * A FAILSAFE rather than the mechanism, which is why it is a minute rather than the five seconds it
 * used to be. `/admin/eventfeed` carries `source-listeners-changed` on every change in either
 * direction, with an authoritative count, so the arrival that opens the gate and the departure that
 * eventually closes it both land within milliseconds. What the poll is still for is the cases the
 * feed cannot cover: a 2.4 server, which has no feed at all; a feed that has dropped and not
 * reconnected yet; and the window before the poll that discovers the admin endpoint has run, since
 * the feed only attaches once it has.
 *
 * The exposure that buys is up to a minute of silence for somebody who tunes in while the feed is
 * down, and it is accepted deliberately: `IcecastEventFeed` retries a drop immediately with backoff,
 * so the window is short and rare, and a second poll rate to reason about is worse than the case it
 * would cover.
 */
export const AUDIENCE_POLL_MS = 60_000;

/**
 * How long the last listener counts as still being there.
 *
 * It used to be a minute, and it was cover for a missed departure as much as anything: the count
 * could be wrong in the direction that mattered, so the window had to absorb that. It no longer
 * does — `source-listeners-changed` reports both edges — so this is now only what it says it is:
 * **how long the station holds the mount for somebody who might come back.**
 *
 * Five minutes, because a player reconnecting (a network blip, a phone changing radios, an operator
 * moving the console between tabs) should not cost a mount rebuild, and the rebuild is audible while
 * the gap is not. What it costs is five minutes of provider fetching and model work per departure,
 * on a station nobody is listening to.
 */
const AUDIENCE_LINGER_MS = 5 * 60_000;

@Injectable()
export class AudienceWatch {
    private timer?: NodeJS.Timeout;
    /** The audience: Icecast's listeners plus the HLS ones. `undefined` before the first answer. */
    private count?: number;
    /**
     * The Icecast half of it, kept apart so the two can be re-added.
     *
     * An HLS listener arriving must not overwrite what Icecast last said, and an
     * Icecast reading must not overwrite the HLS register — they are counts of
     * different people arriving through different mechanisms, and only the sum is the
     * audience. {@link recount} is where they meet.
     */
    private icecastCount?: number;
    /** When the count was last non-zero, which is what {@link hasAudience} lingers on. */
    private lastHeardAt = 0;
    /**
     * When Icecast last actually told us a number. Undefined until it first does.
     *
     * Not the same fact as the poll's heartbeat, and the gap between them is the whole
     * of what it is for: the heartbeat says the loop came round, this says there was an
     * ANSWER. A zero the app inferred from a failed request and a zero Icecast reported
     * are the same number and completely different evidence, and in `audience` mode the
     * first one silences the station permanently — the gate opens on a reading that is
     * never going to arrive. See {@link reading}.
     */
    private lastReadAt?: number;
    /** What {@link hasAudience} said at the previous evaluation, so an edge can be announced once. */
    private announced = false;
    /**
     * Who wants to know when the GATE moves, as opposed to when somebody arrives.
     *
     * Deliberately still a list of its own rather than a `StationBus` event, and the two edges this
     * class has are the clearest example of the line that bus draws. The gate is a hot, in-module
     * coupling: its one subscriber is `PlayoutPusher`, which has to bring its reconcile forward in
     * the same breath, and which is registered beside this class rather than six modules away. An
     * arrival is the opposite — a fact about the station that anything might want to act on, and the
     * things that act on it are all downstream of here.
     */
    private readonly listeners = new Set<(open: boolean) => void>();
    /** One poll at a time: a slow Icecast must not stack requests behind the interval. */
    private polling = false;

    /** Stops listening for HLS arrivals. See {@link start}. */
    private unsubscribeHls?: () => void;

    constructor(
        private readonly stats: IcecastStatsClient,
        private readonly feed: IcecastEventFeed,
        // The other half of the audience, and a register rather than a server that can be
        // asked: an HLS listener holds no connection open, so they are counted from the
        // playlist requests their player makes anyway. In the `stream` module beside the
        // Icecast client, so this class reaches for both the same way round.
        private readonly hls: HlsAudience,
        private readonly config: AppConfig,
        private readonly heartbeat: Heartbeat,
        // Where an ARRIVAL goes. What the station does about somebody tuning in is a programming
        // decision, and the things that make one are registered after this module and may not be
        // reached for. The gate edge beside it stays a direct seam; see {@link listeners}.
        private readonly bus: StationBus,
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

        this.heartbeat.register(HEARTBEATS.audiencePoll);
        this.timer = setInterval(() => void this.poll(), AUDIENCE_POLL_MS);
        this.timer.unref?.();
        void this.poll();
        // The push half, where Icecast is new enough to offer one. It hands over whole
        // counts, which is why it can feed `report` directly: a message that never
        // arrives costs the edge, never the number.
        this.feed.watch(this.stats.mountPaths(), count => this.report(count));
        // The same bargain for the HLS half: somebody tuning in there opens the gate on the
        // request that says so rather than up to a minute later at the next poll. A DEPARTURE
        // has no event — it is the absence of a request — so the poll is what notices it, and
        // that is what makes the register's own expiry harmless.
        this.unsubscribeHls = this.hls.onChange(() => this.recount());
        this.logger.info(`audience: watching ${this.stats.mountPaths().join(', ')} every ${AUDIENCE_POLL_MS}ms (linger ${AUDIENCE_LINGER_MS}ms)`);
    }

    /** Stop watching. The last reading is kept, and stops being refreshed. */
    stop(): void {
        this.feed.stop();
        this.unsubscribeHls?.();
        this.unsubscribeHls = undefined;
        this.heartbeat.forget(HEARTBEATS.audiencePoll);
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
     * The audience as one reading, including whether it is worth anything.
     *
     * `readAt` is the field the other two cannot supply. `listenerCount()` answers zero
     * both for an empty room and for an Icecast that is not answering, which is
     * documented on {@link IcecastStatsClient.listeners} as a distinction worth keeping
     * and then thrown away here, because a console cannot render "unknown". This keeps
     * it: absent means Icecast has never answered since the app started, and a stale
     * value means it has stopped.
     *
     * Nothing acts on it. The gate is deliberately unchanged — an app that cannot see
     * Icecast has no evidence anybody is there, and airing on the strength of a failed
     * request would be worse than staying quiet. What this buys is the station being
     * able to SAY that is what happened.
     */
    reading(): { count: number; hasAudience: boolean; readAt?: number } {
        return {
            count: this.listenerCount(),
            hasAudience: this.hasAudience(),
            ...(this.lastReadAt === undefined ? {} : { readAt: this.lastReadAt }),
        };
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
            this.logger.warn(`audience: could not read the listener count (${errorText(error)})`);
        } finally {
            this.polling = false;
            // The loop came round, which is a different fact from Icecast having answered:
            // a poll that failed still beats here, and whether there was an ANSWER is what
            // `lastReadAt` is for. Conflating them would report a dead stats endpoint as a
            // dead app.
            this.heartbeat.beat(HEARTBEATS.audiencePoll);
        }
    }

    /**
     * Record what Icecast says, and announce the edge it produced.
     *
     * Clamped at zero, because the push path counts rather than asks: a departure
     * for a listener this process never saw arrive (an app started after them, an
     * event whose partner was dropped) would otherwise take the reading negative,
     * and the linger window would then never expire against it.
     */
    private accept(count: number): void {
        this.icecastCount = Math.max(0, count);
        // Every path into here carries a number from something that knows one: a poll
        // Icecast answered, an event feed message, or a hook call Icecast is holding a
        // listener's connection open for. All three are proof it is alive, which is why
        // this is stamped in the one place they meet rather than at each of them. The
        // failed poll does not come through here at all; it calls `settle` directly.
        //
        // NOT stamped by the HLS path below, deliberately: an HLS listener is evidence
        // that somebody is there and no evidence at all about Icecast, and conflating the
        // two would report a dead stats endpoint as a healthy one for as long as one
        // person was streaming.
        this.lastReadAt = Date.now();
        this.recount();
    }

    /**
     * The audience, as the sum of the two things that can carry one.
     *
     * Icecast holds each of its listeners' connections open and can simply be asked;
     * an HLS listener holds nothing open and is counted from the playlist requests
     * their player makes anyway. Different mechanisms, one number, and this is the
     * only place it is formed — the alternative is two counts that disagree, and the
     * one that would win is whichever wrote last.
     *
     * Called on an HLS arrival as well as on an Icecast reading, so somebody tuning in
     * over HLS opens the gate at once rather than at the next poll, which is the same
     * bargain the event feed makes for an Icecast listener.
     */
    private recount(): void {
        const before = this.count;
        this.count = (this.icecastCount ?? 0) + this.hls.count();
        if (this.count > 0) this.lastHeardAt = Date.now();

        // Somebody walked into an empty room. Announced from here because this is where every source
        // of a count meets, and off the RAW count rather than off the gate: in `always` mode the gate
        // never moves, so a station on that setting could never greet anybody, and `hasAudience()`
        // lingers for five minutes because that is about holding the mount rather than about anybody
        // being there. `undefined` before counts as empty — the first reading of a room with somebody
        // in it is somebody having arrived, which is exactly what a restart mid-broadcast looks like.
        if ((before ?? 0) === 0 && this.count > 0) this.bus.publish('audience.arrived', { count: this.count });

        if (before !== this.count) {
            // Broken down by mount rather than reported as one figure, because with several
            // mounts published the useful question is not how many are listening but on
            // which of them, and that is the reading nothing else in the station carries.
            const where = [...this.stats.listenersByMount()].map(([mount, listeners]) => `${mount} ${listeners}`);
            const overHls = this.hls.count();
            if (overHls > 0) where.push(`hls ${overHls}`);
            this.logger.debug(`audience: ${this.count} listening (${where.join(', ')})`);
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
                ? `audience: the station may air (${this.mode === 'always' ? 'always on' : 'somebody is listening'})`
                : `audience: nobody has been listening on ${this.stats.mountPaths().join(', ')} for ${AUDIENCE_LINGER_MS}ms; the station stops airing`,
        );
        for (const listener of this.listeners) {
            try {
                listener(open);
            } catch (error) {
                // A subscriber that throws must not stop the others hearing it, and must
                // not kill the poll loop that got here.
                this.logger.warn(`audience: a listener threw on the ${open ? 'open' : 'close'} edge (${errorText(error)})`);
            }
        }
    }
}
