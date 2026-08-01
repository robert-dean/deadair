import { ServerKitMiddleware } from '@maroonedsoftware/koa';
import { setRefreshCookie, wantsRefreshCookie } from '#modules/authentication/refresh.cookie.js';
import { ResponseCookieJar } from '#modules/authentication/response.cookie.jar.js';

/**
 * Delivers refresh tokens as httpOnly cookies (so they never reach JS, immune to XSS exfiltration):
 *  - JSON token responses from clients that opted in (see refresh.cookie.ts): move `refresh_token`
 *    from the body into the cookie and strip it. Inert without the opt-in header, so existing
 *    (mobile / server-to-server) clients keep the body token unchanged.
 *  - Server-rendered flows (e.g. invitation accept) that stash a token in the request-scoped
 *    ResponseCookieJar: set the cookie unconditionally (a browser navigation has no opt-in header).
 *
 * Must run INSIDE jsonMiddleware (pushed after it in the chain) so it sees the still-object body and
 * mutates it before serialization.
 */
export const refreshCookieMiddleware: () => ServerKitMiddleware = () => {
    return async (ctx, next) => {
        await next();

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
