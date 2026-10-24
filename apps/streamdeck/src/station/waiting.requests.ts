import type { ListenerRequest, RequestsClient } from '@deadair/sdk';

import { classify, NotConfigured, retryAfterMs, type Failure } from './connection.failure.js';

/** The part of the station's SDK the Grant key uses: the line, and letting one through. */
export interface WaitingDesk {
    listRequests: RequestsClient['listRequests'];
    grantRequest(id: string): Promise<unknown>;
}

/** One request waiting for an operator, as much of it as a key shows. */
export type Waiting = Pick<ListenerRequest, 'id' | 'title' | 'artist'>;

/** What a Grant key draws from. */
export interface WaitingReading {
    /** The requests waiting for an operator, OLDEST first, as last read. Kept through a failure. */
    waiting?: Waiting[];
    /** Why the latest attempt failed. Absent when it answered. */
    failure?: Failure;
    /** `waiting` is from before the latest attempt, which failed. */
    stale: boolean;
}

export interface WaitingPollerOptions {
    intervalMs?: number;
    maxBackoffMs?: number;
}

/**
 * Between readings of the line. The phone apps list a listener's own requests at this pace, and a
 * request waiting for an operator waits minutes, not seconds: the station lets go of one not placed
 * within the hour.
 */
export const WAITING_INTERVAL_MS = 15_000;

const DEFAULTS = { intervalMs: WAITING_INTERVAL_MS, maxBackoffMs: 60_000 } as const;

/**
 * The requests waiting for an operator, polled once for every Grant key on the deck.
 *
 * `GET /requests?status=waiting`, the console's own list, and only while a Grant key holds it: a deck
 * without one asks nothing, and the transport poller is not made to carry a route that only this key
 * reads. It is the transport poller's shape at a slower pace, with its rules: one reading shared by
 * every key, a failure that keeps the last reading and marks it stale, a backoff that doubles to a
 * ceiling and waits at least as long as a 429 asks, and an answer from a station that has since been
 * replaced dropped when it lands.
 */
export class WaitingPoller {
    private readonly options: Required<WaitingPollerOptions>;
    private readonly listeners = new Set<(reading: WaitingReading) => void>();
    private reading: WaitingReading = { failure: 'unconfigured', stale: false };
    private desk?: WaitingDesk;
    private holders = 0;
    private timer?: ReturnType<typeof setTimeout>;
    private inFlight = false;
    private failures = 0;
    private generation = 0;

    constructor(options: WaitingPollerOptions = {}) {
        this.options = { ...DEFAULTS, ...options };
    }

    get current(): WaitingReading {
        return this.reading;
    }

    /** Hear every reading, starting with the current one, so a key appearing draws at once. */
    subscribe(listener: (reading: WaitingReading) => void): () => void {
        this.listeners.add(listener);
        listener(this.reading);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /** A key appeared. Returns the way to let go. The first hold starts polling and the last release stops it. */
    acquire(): () => void {
        this.holders += 1;
        if (this.holders === 1) void this.poll();
        let released = false;
        return () => {
            if (released) return;
            released = true;
            this.holders -= 1;
            if (this.holders === 0) this.clearTimer();
        };
    }

    /** Point at another station, or at none. What was known about the last one is thrown away. */
    reconfigure(desk: WaitingDesk | undefined): void {
        this.desk = desk;
        this.generation += 1;
        this.failures = 0;
        this.clearTimer();
        this.inFlight = false;
        this.publish(desk === undefined ? { failure: 'unconfigured', stale: false } : { stale: false });
        if (this.holders > 0 && desk !== undefined) void this.poll();
    }

    /**
     * Let the oldest waiting request through, and look at the line again whatever came of it.
     *
     * Thrown to the key that pressed, for it to say so. A 409 is somebody else having decided it
     * first, from the console or another deck, and the reading after shows the line as it now is.
     */
    async grant(id: string): Promise<void> {
        const desk = this.desk;
        if (desk === undefined) throw new NotConfigured();
        try {
            await desk.grantRequest(id);
            // Out of the line at once, so a second press lets the next one through rather than asking
            // for this one again while a reading that predates the grant may still be on its way.
            const waiting = this.reading.waiting;
            if (desk === this.desk && waiting !== undefined) this.publish({ ...this.reading, waiting: waiting.filter(request => request.id !== id) });
        } finally {
            this.failures = 0;
            this.clearTimer();
            if (this.holders > 0) void this.poll();
        }
    }

    private async poll(): Promise<void> {
        const desk = this.desk;
        if (desk === undefined || this.inFlight) return;
        const generation = this.generation;
        this.inFlight = true;
        let wait = this.options.intervalMs;
        try {
            const { requests } = await desk.listRequests({ status: 'waiting' });
            if (generation !== this.generation) return;
            this.failures = 0;
            // The station lists newest first; a key lets through the one that has waited longest.
            const waiting = requests
                .filter(request => request.status === 'waiting')
                .reverse()
                .map(({ id, title, artist }) => ({ id, title, artist }));
            this.publish({ waiting, stale: false });
        } catch (error) {
            if (generation !== this.generation) return;
            this.failures += 1;
            const backoff = Math.min(this.options.intervalMs * 2 ** (this.failures - 1), this.options.maxBackoffMs);
            wait = Math.max(backoff, retryAfterMs(error) ?? 0);
            const failure = classify(error);
            this.publish(this.reading.waiting === undefined ? { failure, stale: false } : { waiting: this.reading.waiting, failure, stale: true });
        } finally {
            if (generation === this.generation) {
                this.inFlight = false;
                if (this.holders > 0) this.schedule(wait);
            }
        }
    }

    private schedule(ms: number): void {
        this.clearTimer();
        this.timer = setTimeout(() => void this.poll(), ms);
    }

    private clearTimer(): void {
        if (this.timer !== undefined) clearTimeout(this.timer);
        this.timer = undefined;
    }

    private publish(reading: WaitingReading): void {
        this.reading = reading;
        for (const listener of this.listeners) listener(reading);
    }
}
