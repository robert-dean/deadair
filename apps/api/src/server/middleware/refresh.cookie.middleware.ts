import { ServerKitMiddleware } from '@maroonedsoftware/koa';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie, wantsRefreshCookie } from '#modules/authentication/refresh.cookie.js';
import { RequestCookieJar } from '#modules/authentication/request.cookie.jar.js';
import { ResponseCookieJar } from '#modules/authentication/response.cookie.jar.js';

/**
 * Bridges the httpOnly refresh cookie (so refresh tokens never reach JS, immune to XSS
 * exfiltration) and the request-scoped cookie jars, in both directions.
 *
 * Inbound, before the route runs:
 *  - stash the presented refresh cookie in the RequestCookieJar, so the refresh grant can redeem it
 *    for a browser client that sends no `refresh_token` in the body.
 *
 * Outbound, after the route:
 *  - JSON token responses from clients that opted in (see refresh.cookie.ts): move `refresh_token`
 *    from the body into the cookie and strip it. Inert without the opt-in header, so existing
 *    (mobile / server-to-server) clients keep the body token unchanged.
 *  - Server-rendered flows (e.g. invitation accept) that stash a token in the request-scoped
 *    ResponseCookieJar: set the cookie unconditionally (a browser navigation has no opt-in header).
 *  - Flows that asked the ResponseCookieJar to clear the cookie (logout, a rejected refresh grant):
 *    expire it. This one also runs when the route threw, so a 401 still clears a dead cookie.
 *
 * Must run INSIDE jsonMiddleware (pushed after it in the chain) so it sees the still-object body and
 * mutates it before serialization. Reading a cookie needs no parsed body, so the inbound half is
 * happy at the same position.
 */
export const refreshCookieMiddleware: () => ServerKitMiddleware = () => {
    return async (ctx, next) => {
        const presented = readRefreshCookie(ctx);
        if (presented) {
            ctx.container.get(RequestCookieJar).setRefreshToken(presented);
        }

        try {
            await next();
        } finally {
            // Logout and friends: the flow revoked the session, so drop the browser's cookie.
            // Drained in `finally` because the error path needs it most: a rejected refresh grant
            // throws 401, and code after `await next()` would never run, leaving the browser
            // re-presenting a dead token on every boot until it expires naturally.
            if (ctx.container.get(ResponseCookieJar).takeClearRefreshToken()) {
                clearRefreshCookie(ctx);
            }
        }

        // Everything below is success-path only (a thrown error rethrows out of the `finally`).

        // Server-initiated cookie (invitation accept etc.): the flow already decided to set it.
        const stashed = ctx.container.get(ResponseCookieJar).takeRefreshToken();
        if (stashed) {
            setRefreshCookie(ctx, stashed);
        }

        if (!wantsRefreshCookie(ctx)) return;

        const body = ctx.body;
        if (body && typeof body === 'object' && !Buffer.isBuffer(body)) {
            const record = body as Record<string, unknown>;
            if (typeof record.refresh_token === 'string') {
                setRefreshCookie(ctx, record.refresh_token);
                delete record.refresh_token;
            }
        }
    };
};
