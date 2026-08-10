import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { IcecastStatsClient } from './icecast.stats.client.js';
import { SseFrameReader, isMountUri, listenerEvent } from './icecast.eventfeed.parse.js';

/**
 * Icecast telling us about listeners, instead of us asking.
 *
 * `GET /admin/eventfeed` is 2.5's, and it is what upstream points at when it
 * deprecates the document the poll reads: a held-open `text/event-stream` that
 * carries, among other things, a source's listener count whenever it changes. So
 * an arrival or a departure reaches the audience gate in milliseconds rather than
 * at the next five-second poll.
 *
 * It is the PUSH half and never the truth. The poll stays exactly as it was, for
 * the reason `AudienceWatch` already states: a feed can drop, a socket can die
 * quietly, and a station that believed a message it never received would air to
 * an empty room. Everything here is therefore best-effort — it connects when it
 * can, it reconnects when it cannot, and it never throws at the thing that
 * started it.
 *
 * **It stays asleep on Icecast 2.4.** The feed only exists on a server that also
 * serves the admin stats endpoint, so this waits for the poll to have resolved
 * that endpoint before opening anything. On the pinned 2.4.4 image it never
 * connects and costs nothing.
 *
 * Note this is the INBOUND direction, which is why it parses SSE by hand rather
 * than using ServerKit's: `openSseStream` and `serverFeedRouter` push events out
 * to a browser, and Node's own `EventSource` cannot carry the admin credentials
 * this endpoint needs.
 */

/** How long to wait before looking again when there is no 2.5 server to attach to. */
const IDLE_RETRY_MS = 30_000;

/** Backoff bounds for a feed that dropped. Short at first, because the first drop is usually a restart. */
const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 30_000;

@Injectable()
export class IcecastEventFeed {
    /** Whether {@link watch} has been called and {@link stop} has not. */
    private running = false;
    /** Aborts the connection in flight, which is how a read that is parked on a socket ends. */
    private connection?: AbortController;
    /** Wakes the loop early when it is parked between attempts. */
    private wake?: () => void;
    private retryMs = RETRY_MIN_MS;
    /** The mount whose events matter, and who to hand a count to. Set by {@link watch}. */
    private mount = '';
    private onCount?: (count: number) => void;
    /** Whether a failure to connect has already been said, so a retry loop cannot fill the log. */
    private reportedDown = false;
    /** Whether being attached has been said, so a reconnect storm cannot either. */
    private announced = false;

    constructor(
        private readonly stats: IcecastStatsClient,
        private readonly logger: Logger,
    ) {}

    /**
     * Start following the feed for one mount. Idempotent.
     *
     * The callback is handed a WHOLE count, never a delta, which is what makes a
     * dropped message harmless: the next event replaces the number rather than
     * adjusting it.
     */
    watch(mount: string, onCount: (count: number) => void): void {
        this.mount = mount;
        this.onCount = onCount;
        if (this.running) return;

        this.running = true;
        void this.loop();
    }

    /** Stop following it. The connection in flight is aborted rather than left to time out. */
    stop(): void {
        this.running = false;
        this.connection?.abort();
        this.connection = undefined;
        this.wake?.();
    }

    /** Whether the feed is attached right now, for a caller reporting on the station's plumbing. */
    attached(): boolean {
        return this.connection !== undefined;
    }

    /**
     * Connect, read until the feed ends, wait, do it again.
     *
     * One loop rather than a timer per attempt, so there is exactly one place that
     * decides whether to be connected and exactly one connection to abort.
     */
    private async loop(): Promise<void> {
        while (this.running) {
            const api = this.stats.adminApi();
            if (!api) {
                // Either the poll has not resolved a server yet, or the one it resolved is a
                // 2.4 that has no feed. Neither is a fault, and neither is worth a log line.
                await this.pause(IDLE_RETRY_MS);
                continue;
            }

            const dropped = await this.follow(api.base, api.password);
            if (!this.running) return;

            this.retryMs = dropped ? RETRY_MIN_MS : Math.min(this.retryMs * 2, RETRY_MAX_MS);
            await this.pause(this.retryMs);
        }
    }

    /**
     * One connection, read to its end.
     *
     * @returns true when the feed was attached and later ended, which is a restart
     * or a network blip and deserves an immediate retry; false when it never
     * attached, which deserves a longer one.
     */
    private async follow(base: string, password: string): Promise<boolean> {
        const controller = new AbortController();
        this.connection = controller;
        let attached = false;

        try {
            const response = await fetch(`${base}/admin/eventfeed`, {
                signal: controller.signal,
                headers: { authorization: `Basic ${Buffer.from(`admin:${password}`).toString('base64')}` },
            });

            if (!response.ok || !response.body) {
                await response.body?.cancel().catch(() => {});
                this.noteDown(`${base}/admin/eventfeed answered ${response.status}`);
                return false;
            }

            attached = true;
            this.reportedDown = false;
            this.retryMs = RETRY_MIN_MS;
            if (!this.announced) {
                this.announced = true;
                this.logger.info(`icecast: following the event feed on ${base} for ${this.mount}`);
            }

            await this.read(response.body);
            return true;
        } catch (error) {
            // An abort is us stopping, not a failure worth reporting.
            if (!controller.signal.aborted) this.noteDown(message(error));
            return attached;
        } finally {
            if (this.connection === controller) this.connection = undefined;
        }
    }

    /** Drain the stream, turning frames into counts for the watched mount. */
    private async read(body: ReadableStream<Uint8Array>): Promise<void> {
        const frames = new SseFrameReader();
        const decoder = new TextDecoder();

        for await (const chunk of body) {
            for (const payload of frames.push(decoder.decode(chunk, { stream: true }))) {
                const event = listenerEvent(payload);
                if (!event || !isMountUri(event.uri, this.mount)) continue;

                this.logger.debug(`icecast: ${event.trigger || 'event'} on ${event.uri} — ${event.listeners} listening`);
                this.onCount?.(event.listeners);
            }
        }
    }

    /** Say once why the feed is not attached. Repeats are the same sentence at a slower rate. */
    private noteDown(reason: string): void {
        this.announced = false;
        if (this.reportedDown) return;

        this.reportedDown = true;
        this.logger.info(`icecast: no event feed (${reason}); the audience is the poll alone until it comes back`);
    }

    /** Wait, unless {@link stop} happens first. */
    private async pause(ms: number): Promise<void> {
        await new Promise<void>(resolve => {
            const timer = setTimeout(() => {
                this.wake = undefined;
                resolve();
            }, ms);
            timer.unref?.();

            this.wake = () => {
                clearTimeout(timer);
                this.wake = undefined;
                resolve();
            };
        });
    }
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));
