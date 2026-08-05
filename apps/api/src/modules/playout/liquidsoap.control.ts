import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { LiquidsoapEndpoint } from './liquidsoap.endpoint.js';

/**
 * Client for the playout control endpoints in `stream/radio.liq`: the app's half
 * of the push model.
 *
 * Everything is best-effort — an unreachable stream resolves to `undefined` or
 * `false` rather than throwing — because the caller ({@link PlayoutPusher}) runs
 * on a reconcile loop, and a stream that is down is a normal state rather than
 * an error. A failed call invalidates the endpoint so the next one re-probes
 * instead of retrying an address that has gone away.
 */

/** Local calls against an in-memory queue; a live Liquidsoap answers in milliseconds. */
const CONTROL_TIMEOUT_MS = 2000;

/**
 * What Liquidsoap reports about its playout queue: `radio.liq`'s `playout_reading`.
 *
 * Everything past `queued` is optional because a running Liquidsoap may be on an
 * older script — the app deploys independently of the container. Absent means
 * "not reported", never "zero".
 */
export interface QueueStatus {
    /**
     * Requests waiting, EXCLUDING the one on air: both the pending queue and the
     * one already resolved (downloaded) by the prefetch. The depth the pusher
     * tops up against.
     */
    queued: number;
    /**
     * Whether the queue is actually producing audio. False means the mount has
     * fallen through to another bed, so nothing in the running order is being
     * heard — the only positive signal that an item ENDED, which a boundary
     * never gives (it only ever says a new one started).
     */
    ready?: boolean;
    /** Rundown item id on air, per the queue's own track boundary. Absent when nothing is. */
    onAir?: string;
    /**
     * Milliseconds left of the item on air, or `undefined` when the decoder
     * cannot say. This is the decoder's position, so it leads the listener by the
     * encoder and client buffers.
     */
    remainingMs?: number;
}

@Injectable()
export class PlayoutControlClient {
    /** Whether the last call to the stream actually got an answer. See {@link isUp}. */
    private up = false;

    constructor(
        private readonly endpoint: LiquidsoapEndpoint,
        private readonly logger: Logger,
    ) {}

    /**
     * Whether the stream answered the most recent call.
     *
     * Deliberately the outcome of a real call rather than
     * {@link LiquidsoapEndpoint.resolve}: a configured `LIQUIDSOAP_CONTROL_URL`
     * is returned unprobed (it is a pin, not a guess), so resolving one would
     * report a stream as reachable purely because an operator named an address.
     *
     * Never more than one reconcile tick stale, because the pusher's loop is
     * itself a call. False before the first one, which is the honest answer:
     * nothing has been heard from yet.
     */
    isUp(): boolean {
        return this.up;
    }

    /** One reading of the queue, or `undefined` when the stream is not reachable. */
    async status(): Promise<QueueStatus | undefined> {
        return parseReading(await this.call('GET', '/control/status'));
    }

    /** Push one `annotate:` uri onto the queue. False when it did not land. */
    async push(uri: string): Promise<boolean> {
        return !!(await this.call('POST', '/control/push', uri));
    }

    /**
     * Drop everything queued but not yet airing. What is on air finishes: the
     * station stops committing to a running order it has abandoned, it does not
     * cut the listener off mid-track.
     */
    async flush(): Promise<boolean> {
        return !!(await this.call('POST', '/control/flush'));
    }

    /**
     * End the item on air so the queue advances immediately — the operator skip.
     * The opposite of {@link flush}: this one is only about what is playing and
     * leaves the running order behind it untouched.
     */
    async skip(): Promise<boolean> {
        return !!(await this.call('POST', '/control/skip'));
    }

    /** One control call. Resolves to the parsed JSON body, or `undefined` on any failure. */
    private async call(method: 'GET' | 'POST', path: string, body?: string): Promise<unknown> {
        const base = await this.endpoint.resolve();
        if (!base) {
            // Nothing answered the probe, so there is no address to be up at.
            this.up = false;
            return undefined;
        }

        try {
            const response = await fetch(`${base}${path}`, {
                method,
                headers: {
                    'X-Playout-Secret': this.endpoint.secret(),
                    ...(body === undefined ? {} : { 'Content-Type': 'text/plain' }),
                },
                body,
                signal: AbortSignal.timeout(CONTROL_TIMEOUT_MS),
            });

            if (!response.ok) {
                // 401 means the secret diverged (Liquidsoap still on a stale radio.env);
                // anything else is a bug in the handler. Both are worth saying out loud.
                // Not "down": something answered, it just refused — and a console that
                // said the stream was unreachable would send the operator looking for
                // the wrong fault.
                this.up = true;
                this.logger.warn(`liquidsoap: ${method} ${path} answered ${response.status}`);
                return undefined;
            }
            this.up = true;
            return (await response.json()) as unknown;
        } catch (error) {
            // Unreachable, timed out, or a body that is not JSON: the stream may have
            // restarted, so drop the cached address and let the next call re-probe.
            this.up = false;
            this.endpoint.invalidate();
            this.logger.warn(`liquidsoap: ${method} ${path} failed (${errorText(error)})`);
            return undefined;
        }
    }
}

/**
 * Parse one `playout_reading` body.
 *
 * `queued` is required — a body without it is not a reading at all, which is how
 * a 401 page or some other service on the port is rejected. Everything else is
 * dropped unless it is present AND well-formed, so a partial answer degrades to
 * "not reported" instead of a confident wrong number.
 *
 * Exported for tests: this is the whole compatibility boundary between the app
 * and the stream.
 */
export function parseReading(body: unknown): QueueStatus | undefined {
    if (!body || typeof body !== 'object') return undefined;

    const raw = body as Record<string, unknown>;
    const queued = Number(raw.queued);
    if (!Number.isFinite(queued)) return undefined;

    const status: QueueStatus = { queued };
    if (typeof raw.ready === 'boolean') status.ready = raw.ready;
    // "" is radio.liq's "nothing on air", not an id.
    if (typeof raw.onAir === 'string' && raw.onAir !== '') status.onAir = raw.onAir;
    // radio.liq sends -1 for "cannot say". A 0 would mean an item with no time left,
    // which is never actionable: the boundary that proves it is a moment away.
    const remaining = Number(raw.remainingMs);
    if (Number.isFinite(remaining) && remaining > 0) status.remainingMs = remaining;
    return status;
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));
