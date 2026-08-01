import { Injectable } from 'injectkit';

/**
 * Request-scoped holder for a refresh token that a server-rendered flow (e.g. invitation-accept,
 * which returns an HTML redirect, not a JSON body) wants delivered as an httpOnly cookie. The
 * service sets it; refreshCookieMiddleware drains it on the way out and writes the cookie — keeping
 * services decoupled from the Koa context. Registered `asScoped`, so the instance the service writes
 * to is the same one the middleware reads via `ctx.container` within a request.
 */
@Injectable()
export class ResponseCookieJar {
    private pendingRefreshToken?: string;

    setRefreshToken(token: string): void {
        this.pendingRefreshToken = token;
    }

    takeRefreshToken(): string | undefined {
        const token = this.pendingRefreshToken;
        this.pendingRefreshToken = undefined;
        return token;
    }
}
