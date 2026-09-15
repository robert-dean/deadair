import type { PlayoutClient, PlayoutStatus } from '@deadair/sdk';

import { classify, NotConfigured, retryAfterMs, type Failure } from './connection.failure.js';

/** The part of the station's SDK the keys use: the transport reading and the three verbs. */
export type Playout = Pick<PlayoutClient, 'getPlayoutStatus' | 'skipTheCurrentItem' | 'startPlayout' | 'stopPlayout'>;

/** What every key draws from. */
export interface Reading {
    /** The last reading the station gave. Kept through a failure, because blanking it throws away something true. */
    status?: PlayoutStatus;
    /** When `status` was read, in epoch milliseconds. */
    readAt?: number;
    /** Why the latest attempt failed. Absent when it answered. */
    failure?: Failure;
    /** `status` is from before the latest attempt, which failed. */
    stale: boolean;
}

export interface PollerOptions {
    /** Between readings while the station answers. The console's two seconds, which is the station's own reconcile tick. */
    intervalMs?: number;
    /** When to look again after a command, from its answer. The console's schedule. */
    followUpMs?: readonly number[];
    /** The longest a failing station is left between attempts. */
    maxBackoffMs?: number;
}

const DEFAULTS = { intervalMs: 2_000, followUpMs: [400, 1_000, 2_500], maxBackoffMs: 30_000 } as const;

/**
 * The transport reading, polled once for every key on the deck.
 *
 * ONE poller, however many keys are showing, because the station rate-limits by address (a hundred
 * points in five seconds) and that bucket is shared with anything else on the operator's network. Six
 * keys each polling would be six times the load for one answer.
 *
 * It polls only while a key holds it: `acquire` on a key appearing, the release on it going. A deck
 * on another page, or a Stream Deck app with the profile closed, asks the station nothing.
 *
 * The station has no push channel, so this is the seam a feed would replace: keys only ever
 * `subscribe`, and never learn where readings come from.
 */
export class StatusPoller {
    private readonly options: Required<PollerOptions>;
    private readonly listeners = new Set<(reading: Reading) => void>();
    private reading: Reading = { failure: 'unconfigured', stale: false };
    private playout?: Playout;
    private holders = 0;
    private timer?: ReturnType<typeof setTimeout>;
    private followUps: ReturnType<typeof setTimeout>[] = [];
    private inFlight = false;
    private failures = 0;
    private pauseUntil = 0;
    /** Bumped whenever the station changes, so an answer from the old one is dropped when it lands. */
    private generation = 0;

    constructor(options: PollerOptions = {}) {
        this.options = { ...DEFAULTS, ...options };
    }

    get current(): Reading {
        return this.reading;
    }

    /** Hear every reading, starting with the current one, so a key appearing draws at once. */
    subscribe(listener: (reading: Reading) => void): () => void {
        this.listeners.add(listener);
        listener(this.reading);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /** One more key wants readings. Returns its release, which is safe to call twice. */
    acquire(): () => void {
        this.holders += 1;
        if (this.holders === 1) this.schedule(0);
        let released = false;
        return () => {
            if (released) return;
            released = true;
            this.holders -= 1;
            if (this.holders === 0) this.stop();
        };
    }

    /**
     * Point at a station, or at none. The reading goes with the old one, since it describes the
     * wrong station, and the backoff starts over, since the new one has not failed yet.
     */
    reconfigure(playout: Playout | undefined): void {
        this.generation += 1;
        this.playout = playout;
        this.inFlight = false;
        this.failures = 0;
        this.pauseUntil = 0;
        this.clearFollowUps();
        this.publish(playout ? { stale: false } : { failure: 'unconfigured', stale: false });
        if (this.holders > 0) this.schedule(0);
    }

    /**
     * Drive the transport. Every verb answers with the reading it produced, so that is published at
     * once, and the station is asked again three times over the next few seconds, because the move
     * takes longer than the request: the player's boundary and Liquidsoap's notify can land just
     * after the answer. A second command replaces the first one's schedule rather than stacking on it.
     *
     * A failure is thrown to the key that asked, for it to say so, and does not touch the reading:
     * a refused Skip says nothing about whether the station can be read.
     */
    async command(verb: (playout: Playout) => Promise<PlayoutStatus>): Promise<PlayoutStatus> {
        const playout = this.playout;
        if (!playout) throw new NotConfigured();
        const generation = this.generation;
        const status = await verb(playout);
        if (generation === this.generation) {
            this.failures = 0;
            this.pauseUntil = 0;
            this.publish({ status, readAt: Date.now(), stale: false });
            this.clearFollowUps();
            this.followUps = this.options.followUpMs.map(delay => setTimeout(() => void this.poll(), delay));
        }
        return status;
    }

    private schedule(delayMs: number): void {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => void this.tick(), delayMs);
    }

    private async tick(): Promise<void> {
        await this.poll();
        if (this.holders > 0) this.schedule(this.nextDelay());
    }

    /**
     * Two seconds while the station answers. After a failure, twice as long each time up to thirty
     * seconds: a station that is down is asked about eight times a minute rather than thirty, and a
     * revoked key does not knock on the door every two seconds for as long as the deck is on. A 429
     * waits at least as long as the station asked.
     */
    private nextDelay(): number {
        const { intervalMs, maxBackoffMs } = this.options;
        const backoff = this.failures === 0 ? intervalMs : Math.min(intervalMs * 2 ** (this.failures - 1), maxBackoffMs);
        return Math.max(backoff, this.pauseUntil - Date.now());
    }

    private async poll(): Promise<void> {
        const playout = this.playout;
        if (!playout || this.inFlight) return;
        this.inFlight = true;
        const generation = this.generation;
        try {
            const status = await playout.getPlayoutStatus();
            if (generation !== this.generation) return;
            this.failures = 0;
            this.publish({ status, readAt: Date.now(), stale: false });
        } catch (error) {
            if (generation !== this.generation) return;
            this.failures += 1;
            const wait = retryAfterMs(error);
            if (wait !== undefined) this.pauseUntil = Date.now() + wait;
            const { status, readAt } = this.reading;
            this.publish({
                ...(status ? { status } : {}),
                ...(readAt === undefined ? {} : { readAt }),
                failure: classify(error),
                stale: status !== undefined,
            });
        } finally {
            if (generation === this.generation) this.inFlight = false;
        }
    }

    private stop(): void {
        clearTimeout(this.timer);
        this.timer = undefined;
        this.clearFollowUps();
    }

    private clearFollowUps(): void {
        for (const timer of this.followUps.splice(0)) clearTimeout(timer);
    }

    private publish(reading: Reading): void {
        this.reading = reading;
        for (const listener of this.listeners) listener(reading);
    }
}
