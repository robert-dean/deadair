import type { Context } from 'koa';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { requestIsSecure, trustsProxy } from '#modules/shared/request.trust.js';

// Cookie-based refresh tokens. A web client opts in by sending REFRESH_COOKIE_OPT_IN_HEADER on its
// auth requests; the server then delivers the refresh token as an httpOnly cookie (never readable by
// JS, so immune to XSS exfiltration) instead of in the JSON body, and the /auth/refresh + /auth/logout
// endpoints read/clear it. Non-web clients (mobile, server-to-server) omit the header and keep the
// body-token behavior unchanged.

export const REFRESH_COOKIE_NAME = 'deadair.rt';

// Presence of this header (any value) on a request signals the client wants cookie-based refresh.
export const REFRESH_COOKIE_OPT_IN_HEADER = 'x-deadair-refresh-cookie';

// Refresh cookie lifetime. Should be >= the refresh token's own TTL so the browser doesn't drop a
// still-valid token; the token itself remains the authority (an expired token is rejected on refresh).
const REFRESH_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export const wantsRefreshCookie = (ctx: Context): boolean => ctx.get(REFRESH_COOKIE_OPT_IN_HEADER) !== '';

/**
 * Whether THIS request arrived over TLS, and why that is the question rather than
 * `NODE_ENV === 'production'`.
 *
 * It was the environment for as long as it existed, which is a claim about the
 * build and not about the connection, and the two come apart in the deployment
 * this ships as: production is one container behind an nginx listening on port 80,
 * so the cookie asked to be `secure` over a connection Koa knows is plain. The
 * cookie jar refuses that outright — `Cannot send secure cookie over unencrypted
 * connection` — and the throw lands in `refreshCookieMiddleware`'s `finally`,
 * where the whole point is clearing a dead cookie after a 401. So a station whose
 * refresh token had expired answered 500 instead of 401, kept the dead cookie, and
 * presented it again on the next boot, forever.
 *
 * Asking the request instead is right in all three worlds: TLS terminated at the
 * app, TLS terminated at a trusted edge (`X-Forwarded-Proto`), and the plain-HTTP
 * home server, which gets a cookie that is merely not marked `secure` rather than
 * one that could not be sent at all.
 */
const secureRequest = (ctx: Context): boolean => requestIsSecure(ctx, trustsProxy(ctx.container.get(AppConfig)));

const cookieOptions = (ctx: Context) => ({
    httpOnly: true,
    // Marked `secure` exactly when the browser's own hop was encrypted. With the web app served
    // same-origin (via the Vite dev proxy) SameSite=Lax is sufficient and avoids third-party-cookie
    // handling.
    secure: secureRequest(ctx),
    sameSite: 'lax' as const,
    path: '/',
    overwrite: true,
});

/**
 * The jar's own idea of the scheme, corrected before it can veto.
 *
 * Koa builds `ctx.cookies` with `secure: this.request.secure`, which behind a proxy
 * is the INSIDE hop and therefore false on a station that is served over https —
 * and the jar throws on a `secure` cookie whenever its own answer is false. The
 * decision above is the better-informed one, so it is what the jar is told; nothing
 * else in a request reads this cookie jar.
 */
const withScheme = (ctx: Context, secure: boolean): Context['cookies'] => {
    if (secure) ctx.cookies.secure = true;

    return ctx.cookies;
};

export const setRefreshCookie = (ctx: Context, refreshToken: string): void => {
    const options = cookieOptions(ctx);

    withScheme(ctx, options.secure).set(REFRESH_COOKIE_NAME, refreshToken, { ...options, maxAge: REFRESH_COOKIE_MAX_AGE_MS });
};

export const readRefreshCookie = (ctx: Context): string | undefined => ctx.cookies.get(REFRESH_COOKIE_NAME);

export const clearRefreshCookie = (ctx: Context): void => {
    // Setting the value to null with maxAge 0 expires the cookie. Same attributes as when set, so the
    // browser matches and removes it.
    const options = cookieOptions(ctx);

    withScheme(ctx, options.secure).set(REFRESH_COOKIE_NAME, null, { ...options, maxAge: 0 });
};
