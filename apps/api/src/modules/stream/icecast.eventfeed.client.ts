import http from 'node:http';
import https from 'node:https';
import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { IcecastStatsClient } from './icecast.stats.client.js';
import { SseFrameReader, isMountUri, listenerEvent } from './icecast.eventfeed.parse.js';
import { errorText } from '#modules/shared/error.text.js';

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
 * that endpoint before opening anything, and attaches on the poll that finds one.
 * Against a 2.4 server it never opens a socket and costs nothing.
 *
 * Note this is the INBOUND direction, which is why it parses SSE by hand rather
 * than using ServerKit's: `openSseStream` and `serverFeedRouter` push events out
 * to a browser, and Node's own `EventSource` cannot carry the admin credentials
 * this endpoint needs.
 *
 * **It is `node:http` rather than `fetch`, and that is not a style choice.** The
 * platform's `fetch` applies a 300s idle timeout to a response body, which is a
 * sane default for a body and exactly wrong for a socket whose whole job is to
 * stay silent while nobody is listening: it killed this feed every five minutes
 * to the second, all night. Icecast only learns a client is gone when it next
 * tries to WRITE to it, so an idle feed reconnecting on a five-minute clock
 * stranded a client slot each time and walked `<clients>` (100) down to nothing
 * inside a day — at which point Icecast refuses every listener and every stats
 * read while the source connection stays perfectly up, which is a station that
 * looks fine from the inside and answers nobody. `node:http` has no such
 * timeout, and the one here is set to zero explicitly so a future default cannot
 * reintroduce it. A silent feed is the normal state, not a fault.
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
    /** The mounts whose events matter, and who to hand a count to. Set by {@link watch}. */
    private mounts: string[] = [];
    private onCount?: (count: number) => void;
    /** Whether a failure to connect has already been said, so a retry loop cannot fill the log. */
    private reportedDown = false;
    /** Whether being attached has been said, so a reconnect storm cannot either. */
    private announced = false;
    /** Stops listening for the poll settling on an endpoint. See {@link watch}. */
    private unsubscribe?: () => void;

    constructor(
        private readonly stats: IcecastStatsClient,
        private readonly logger: Logger,
    ) {}

    /**
     * Start following the feed for the station's mounts. Idempotent.
     *
     * The callback is handed a WHOLE count, never a delta, which is what makes a
     * dropped message harmless: the next event replaces the number rather than
     * adjusting it.
     *
     * A message names ONE mount and the callback wants the audience, so the
     * reconciliation is not done here: the count goes to
     * {@link IcecastStatsClient.noteMountCount}, which holds what the poll last
     * said about every other mount and answers with the new total. Summing only
     * the mounts this feed had happened to hear about would publish a total that
     * omits a whole mount's listeners, and in `audience` mode a total that is too
     * small is the number that takes the station off the air.
     */
    watch(mounts: string[], onCount: (count: number) => void): void {
        this.mounts = mounts;
        this.onCount = onCount;
        if (this.running) return;

        this.running = true;
        // The poll is what discovers whether this Icecast has a feed at all, so the
        // moment it settles on an endpoint is the moment to try — rather than up to
        // IDLE_RETRY_MS later, which would leave a freshly booted station without its
        // push half for no reason.
        this.unsubscribe = this.stats.onResolved(() => this.wake?.());
        void this.loop();
    }

    /** Stop following it. The connection in flight is aborted rather than left to time out. */
    stop(): void {
        this.running = false;
        this.unsubscribe?.();
        this.unsubscribe = undefined;
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
    private follow(base: string, password: string): Promise<boolean> {
        const controller = new AbortController();
        this.connection = controller;

        return new Promise<boolean>(resolve => {
            const url = new URL(`${base}/admin/eventfeed`);
            const transport = url.protocol === 'https:' ? https : http;
            let attached = false;
            let settled = false;

            /** End this attempt once, whichever of the several ways it can end happens first. */
            const settle = (dropped: boolean, reason?: string): void => {
                if (settled) return;
                settled = true;
                if (this.connection === controller) this.connection = undefined;
                // An abort is us stopping, not a failure worth reporting.
                if (reason !== undefined && !controller.signal.aborted) this.noteDown(reason);
                resolve(dropped);
            };

            const request = transport.request(
                url,
                {
                    signal: controller.signal,
                    // No pooled agent: the global one carries a socket timeout sized for
                    // ordinary requests, and this socket is meant to sit idle for hours.
                    agent: false,
                    headers: { authorization: `Basic ${Buffer.from(`admin:${password}`).toString('base64')}` },
                },
                response => {
                    const status = response.statusCode ?? 0;
                    if (status < 200 || status > 299) {
                        response.resume();
                        settle(false, `${base}/admin/eventfeed answered ${status}`);
                        return;
                    }

                    attached = true;
                    this.reportedDown = false;
                    this.retryMs = RETRY_MIN_MS;
                    if (!this.announced) {
                        this.announced = true;
                        this.logger.info(`icecast: following the event feed on ${base} for ${this.mounts.join(', ')}`);
                    }

                    this.read(response).then(
                        () => settle(true),
                        error => settle(true, errorText(error)),
                    );
                },
            );

            // Zero rather than unset: silence on this feed is the normal state, so no
            // amount of it may close the socket. See the note at the top of the file.
            request.setTimeout(0);
            request.on('error', error => settle(attached, errorText(error)));
            request.end();
        });
    }

    /** Drain the stream, turning frames into a total across the watched mounts. */
    private async read(body: AsyncIterable<Uint8Array>): Promise<void> {
        const frames = new SseFrameReader();
        const decoder = new TextDecoder();

        for await (const chunk of body) {
            for (const payload of frames.push(decoder.decode(chunk, { stream: true }))) {
                const event = listenerEvent(payload);
                if (!event) continue;

                const mount = this.mounts.find(candidate => isMountUri(event.uri, candidate));
                if (mount === undefined) continue;

                const total = this.stats.noteMountCount(mount, event.listeners);
                this.logger.debug(`icecast: ${event.trigger || 'event'} on ${event.uri} — ${event.listeners} listening, ${total} in all`);
                this.onCount?.(total);
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
