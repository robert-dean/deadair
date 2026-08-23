import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Context } from 'koa';
import { ServerKitMiddleware } from '@maroonedsoftware/koa';
import { httpError } from '@maroonedsoftware/errors';
import { RateLimiterRes, type RateLimiterAbstract } from 'rate-limiter-flexible';
import { DateTime } from 'luxon';
import { headerValue, trustsProxy } from '#modules/shared/request.trust.js';

// Re-exported because this is where the switch was first read and where its bucket-per-invented-
// address argument is written down; the constant itself moved so the cookie's `secure` decision
// could not end up trusting a different edge from the limiter's.
export { TRUST_PROXY_KEY, TRUST_PROXY_DEFAULT } from '#modules/shared/request.trust.js';

/**
 * The rate limiter, keyed on who actually called rather than on who handed the
 * call over.
 *
 * ServerKit ships one of these and it keys on `ctx.ip`, which is the socket's
 * peer unless Koa has been told to trust a proxy. Nothing here ever told it, so
 * every browser reaching the API through nginx shared ONE bucket under the nginx
 * container's address: 100 points per 5 seconds, divided between everyone at the
 * edge, and a burst from one console page spending the budget of every other
 * client behind it. The measured shape was ~250 requests in a single second and
 * 1,664 rejections in an afternoon.
 *
 * The choice is a per-request one rather than a flag on the Koa app, because the
 * callers do not all arrive the same way. Liquidsoap talks to the API DIRECTLY —
 * `playout.urls.ts` says so, and its base URL points past the edge — so it
 * arrives with a real peer address and no forwarded header at all, while the
 * console arrives through nginx with both. A global `app.proxy` would also change
 * `ctx.ip` for the audit trail and everything else that reads it, which is a
 * wider claim than the one being made here.
 *
 * ## Why trusting it has to be opted into
 *
 * A forwarded header is a claim by whoever sent it. It is worth believing exactly
 * when something in front is known to overwrite it, and it is worth nothing when
 * a caller can reach the API directly — there, believing it hands anyone a fresh
 * bucket per address they care to invent, which is the limiter switched off
 * while still appearing to run. So `TRUST_PROXY` is off unless an operator says
 * their edge is real, and turning it on is a statement that the API port is not
 * reachable around the proxy by anyone who matters. The switch itself lives in
 * `#modules/shared/request.trust.js`, because a second reader has arrived: a
 * refresh cookie choosing whether to be `secure` is asking the same question about
 * the same edge, and two switches could answer it differently.
 */

/**
 * Which end of `X-Forwarded-For` is the caller, and why it is the last one.
 *
 * nginx appends with `$proxy_add_x_forwarded_for`, so a client that sends its own
 * `X-Forwarded-For: 10.0.0.1` produces `10.0.0.1, <real peer>` at the app. The
 * LEFTMOST entry is therefore whatever the client felt like writing and the
 * RIGHTMOST is the one nginx added itself, which is the only entry in that list
 * the edge can vouch for. Koa's own `ctx.ip` takes the leftmost, which is the
 * other reason not to reach for `app.proxy` here.
 *
 * With two proxies the rightmost is the inner one and this would want a hop
 * count. There is one proxy; a second would be a change to this line and to the
 * comment above it.
 */
export function clientAddress(ctx: Pick<Context, 'ip' | 'req'>, trustProxy: boolean): string {
    if (!trustProxy) return ctx.ip;

    // Preferred over the forwarded list because nginx SETS it to `$remote_addr`
    // rather than appending, so there is no client-supplied half to reason about.
    // Both `/api/` locations set it; the fallback covers an edge that does not.
    const real = headerValue(ctx, 'x-real-ip');
    if (real !== undefined) return real;

    const forwarded = headerValue(ctx, 'x-forwarded-for');
    if (forwarded === undefined) return ctx.ip;

    const hops = forwarded
        .split(',')
        .map(hop => hop.trim())
        .filter(hop => hop.length > 0);

    return hops.at(-1) ?? ctx.ip;
}

/**
 * The same 429 ServerKit's own middleware answers with, headers included.
 *
 * Reproduced rather than wrapped because the key is the only thing being changed
 * and a caller cannot tell the difference: `retry-after` and the three
 * `x-ratelimit-*` headers are what a well-behaved client backs off on.
 *
 * The limiter's own fail-open behaviour is untouched — the Redis client runs with
 * `enableOfflineQueue: false`, so a blip makes `consume()` reject, and the
 * in-memory `insuranceLimiter` beside it is what keeps that from reading as
 * everybody being rate limited at once.
 */
export const rateLimitMiddleware = (limiter: RateLimiterAbstract, config: AppConfig): ServerKitMiddleware => {
    return async (ctx, next) => {
        const trustProxy = trustsProxy(config);

        try {
            await limiter.consume(clientAddress(ctx, trustProxy));
        } catch (error) {
            const refusal = httpError(429).withHeaders(limitHeaders(limiter, error));

            // A cause only where there is one to report. The limiter's own refusal is a
            // `RateLimiterRes` rather than an `Error` — it carries the budget, which is already
            // on the headers above — where a Redis fault that got past the insurance limiter is a
            // real throw and the only thing that would explain a 429 nobody earned.
            throw error instanceof Error ? refusal.withCause(error) : refusal;
        }

        await next();
    };
};

/** What a client needs to back off with, when the rejection was a limit rather than a fault. */
function limitHeaders(limiter: RateLimiterAbstract, error: unknown): Record<string, string> {
    if (!isLimitReached(error)) return {};

    return {
        'retry-after': (error.msBeforeNext / 1000).toString(),
        'x-ratelimit-limit': limiter.points.toString(),
        'x-ratelimit-remaining': error.remainingPoints.toString(),
        'x-ratelimit-reset': Math.ceil(DateTime.now().plus({ milliseconds: error.msBeforeNext }).toSeconds()).toString(),
    };
}

/**
 * Whether the rejection was the limiter saying no.
 *
 * The duck-typed half is not decoration: `RateLimiterRes` crosses a package
 * boundary here, and an instance minted against a second copy of
 * `rate-limiter-flexible` in the tree fails `instanceof` while being exactly the
 * object it claims to be.
 */
function isLimitReached(error: unknown): error is RateLimiterRes {
    if (error instanceof RateLimiterRes) return true;

    return typeof error === 'object' && error !== null && 'msBeforeNext' in error && 'remainingPoints' in error;
}
