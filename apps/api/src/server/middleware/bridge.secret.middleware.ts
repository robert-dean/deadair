import { timingSafeEqual } from 'node:crypto';
import type { ScopedContainer } from 'injectkit';
import { ServerKitMiddleware } from '@maroonedsoftware/koa';
import { httpError } from '@maroonedsoftware/errors';
import { LiquidsoapEndpoint } from '#modules/playout/liquidsoap.endpoint.js';

/**
 * The gate on the playout bridge: everything under `/playout/bridge/` presents
 * the shared secret, or it does not get in.
 *
 * The bridge is the handful of routes called by a process in the stream
 * container rather than by a person — Icecast reporting a listener, Liquidsoap
 * confirming what went on air. None of them can hold a session, so none of them
 * can be gated by a policy: ContractKit's policies evaluate against an actor
 * resolved from a session, and these callers have neither. What they have is a
 * bare secret in a header.
 *
 * That check used to live in each handler. It worked, and it was the wrong
 * shape: a new bridge route that forgot the call was silently open, and nothing
 * failed to compile to say so. Gating the PREFIX instead makes it structural —
 * a route is protected by living here, and the only way to add an unprotected
 * one is to put it somewhere that is visibly not the bridge.
 *
 * Registered after {@link listenerCredentialMiddleware}, which is what puts
 * Icecast's HTTP-basic password onto the header this reads, and before
 * ServerKit's authentication middleware, so a rejected call never touches the
 * session machinery at all.
 */

/**
 * The gated prefix. A trailing slash, so it can only ever match a path SEGMENT:
 * without it a future `/playout/bridgehead` would be gated by accident, and an
 * accidental gate is as much of a surprise as an accidental hole.
 */
export const BRIDGE_PATH_PREFIX = '/playout/bridge/';

export const bridgeSecretMiddleware = (): ServerKitMiddleware => {
    return async (ctx, next) => {
        if (ctx.path.startsWith(BRIDGE_PATH_PREFIX)) {
            const container = ctx.container as ScopedContainer;
            const expected = container.get(LiquidsoapEndpoint).secret();

            if (!expected) {
                // Nothing could match, so this is not a refusal of the caller: the bridge
                // is not configured and cannot serve anyone. 404 says that; a 401 would
                // send an operator looking for a secret mismatch that does not exist.
                throw httpError(404).withDetails({ message: 'the playout bridge is not configured' });
            }

            const presented = ctx.req.headers['x-playout-secret'];
            if (typeof presented !== 'string' || !safeEqual(presented, expected)) {
                throw httpError(401).withDetails({ message: 'invalid playout bridge secret' });
            }
        }
        await next();
    };
};

/**
 * Constant-time compare that tolerates differing lengths.
 *
 * Constant-time because this is a bare secret checked on the hot path: every
 * listener arriving and leaving runs through here, which is exactly the volume
 * that makes a length-then-bytes short circuit leak it a byte at a time to
 * anything that can measure the response.
 *
 * `timingSafeEqual` throws on a length mismatch, and the length is not the
 * secret, so it is compared first and separately.
 */
function safeEqual(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
}
