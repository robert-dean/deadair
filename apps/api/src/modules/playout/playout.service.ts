import { timingSafeEqual } from 'node:crypto';
import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import { Logger } from '@maroonedsoftware/logger';
import { LiquidsoapEndpoint } from './liquidsoap.endpoint.js';
import { Rundown } from './rundown.js';
import type { PlayoutAiredQuery, PlayoutBridgeHeaders } from './types/playout.types.js';

/**
 * The app's side of the playout bridge.
 *
 * Today that is one inbound call: Liquidsoap telling us which item actually
 * started. The console-facing transport surface joins it in a later phase.
 */
@Injectable()
export class PlayoutService {
    constructor(
        private readonly rundown: Rundown,
        private readonly endpoint: LiquidsoapEndpoint,
        private readonly logger: Logger,
    ) {}

    /**
     * Record the item Liquidsoap has just put on air.
     *
     * Answers 204 even for an id the rundown does not know. The caller is a
     * fire-and-forget `http.post` inside the streaming script that cannot act on
     * a failure, and an unknown id is an ordinary event rather than an error: it
     * is what a Liquidsoap that outlived an app restart reports for the item it
     * is still playing. {@link Rundown.markAired} declines to invent it into the
     * running order, which is the whole handling it needs.
     *
     * @throws 404 while the bridge secret is unseeded (the route is not usable
     *   yet), 401 when the presented secret does not match.
     */
    async confirmAired(query: PlayoutAiredQuery, headers: PlayoutBridgeHeaders): Promise<void> {
        this.requireBridgeSecret(headers['x-playout-secret']);

        if (!this.rundown.markAired(query.item)) {
            this.logger.warn('playout: aired notify named an item the rundown does not hold', { item: query.item });
        }
    }

    /**
     * Gate an internal call on the shared bridge secret.
     *
     * Constant-time, because this is a bare secret compared on every boundary:
     * a length-then-bytes short circuit leaks it a byte at a time to anything
     * that can time the response.
     */
    private requireBridgeSecret(presented: string): void {
        const expected = this.endpoint.secret();
        if (!expected) {
            // Not seeded, so nothing could match. 404 rather than 401: the route is
            // not merely refusing this caller, it cannot serve anyone yet.
            throw httpError(404).withDetails({ message: 'the playout bridge is not configured' });
        }
        if (!safeEqual(presented, expected)) {
            throw httpError(401).withDetails({ message: 'invalid playout bridge secret' });
        }
    }
}

/** Constant-time compare that tolerates differing lengths. */
function safeEqual(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    // timingSafeEqual throws on a length mismatch, and the length is not the secret.
    return left.length === right.length && timingSafeEqual(left, right);
}
