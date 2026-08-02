import { Injectable } from 'injectkit';

/**
 * Request-scoped holder for the refresh token a browser client presented as an httpOnly cookie
 * (see refresh.cookie.ts). refreshCookieMiddleware reads the cookie off the Koa context on the way
 * in and stashes it here; the refresh grant reads it when the request body carries no
 * `refresh_token` — keeping services decoupled from the Koa context. Registered `asScoped`, so the
 * instance the middleware writes via `ctx.container` is the same one the service reads within a
 * request.
 */
@Injectable()
export class RequestCookieJar {
    private refreshToken?: string;

    setRefreshToken(token: string): void {
        this.refreshToken = token;
    }

    getRefreshToken(): string | undefined {
        return this.refreshToken;
    }
}
