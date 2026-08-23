import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Context } from 'koa';
import { settingIsOn } from './setting.flags.js';

/**
 * What a request may be believed about itself, and the one switch that decides it.
 *
 * Two things the app has to know are stated only by the edge in front of it: who
 * called (`X-Real-IP` / `X-Forwarded-For`, read by the rate limiter) and whether
 * the listener at the front was encrypted (`X-Forwarded-Proto`, read when a cookie
 * has to choose whether to be `secure`). Both are claims by whoever sent them, and
 * both are worth exactly as much as the edge is: nginx overwrites them, a caller
 * reaching the API port directly does not.
 *
 * So `TRUST_PROXY` is off unless an operator says their edge is real, and turning
 * it on is a statement that the API port is not reachable around the proxy by
 * anyone who matters. It lives here rather than beside either reader because the
 * two must not be able to disagree about whether the edge is trusted.
 *
 * This is deliberately NOT `app.proxy`, which would change `ctx.ip` for the audit
 * trail and everything else that reads it — a much wider claim than either caller
 * is making. See `rate.limit.middleware.ts` for the other half of that argument.
 */

/** The dotenv key. Infrastructure rather than a station setting, so it is not in `settings.registry.ts`. */
export const TRUST_PROXY_KEY = 'TRUST_PROXY';

/** Off, because the safe default for a claim is not believing it. */
export const TRUST_PROXY_DEFAULT = false;

/** The one read of the switch. A string layer, so `settingIsOn` rather than a boolean `get`. */
export const trustsProxy = (config: AppConfig): boolean => settingIsOn(config, TRUST_PROXY_KEY, TRUST_PROXY_DEFAULT);

/** One header, whichever way Node presented it, or nothing when it is absent or blank. */
export function headerValue(ctx: Pick<Context, 'req'>, name: string): string | undefined {
    const raw = ctx.req.headers[name];
    const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();

    return value === undefined || value.length === 0 ? undefined : value;
}

/**
 * Whether the LISTENER this request arrived at was encrypted, which is not the same
 * question as whether the socket Node is holding is.
 *
 * Node's own answer (`ctx.secure`) is right when the app terminates TLS itself and
 * wrong for every deployment that puts a proxy in front, which is all of them here:
 * the edge listens on 443 and speaks plain HTTP to the app on the inside. The only
 * evidence of the outside scheme is `X-Forwarded-Proto`, which is a claim, so it is
 * read only where the operator has vouched for the edge.
 *
 * The leftmost entry is the outermost hop, and it is the one that matters: the
 * scheme being asked about is the one the BROWSER used. That is the opposite end
 * from `clientAddress`'s pick, deliberately — nginx APPENDS to the forwarded-for
 * list, so its own entry is the rightmost, while it SETS the proto to `$scheme`.
 */
export function requestIsSecure(ctx: Pick<Context, 'secure' | 'req'>, trustProxy: boolean): boolean {
    if (ctx.secure) return true;
    if (!trustProxy) return false;

    const proto = headerValue(ctx, 'x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();

    return proto === 'https';
}
