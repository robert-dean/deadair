import { Injectable } from 'injectkit';

/**
 * Request-scoped holder for refresh-cookie writes a service wants performed on the way out:
 *  - a refresh token that a server-rendered flow (e.g. invitation-accept, which returns an HTML
 *    redirect, not a JSON body) wants delivered as an httpOnly cookie;
 *  - a request to clear the cookie (logout).
 *
 * The service sets it; refreshCookieMiddleware drains it on the way out and writes/clears the
 * cookie — keeping services decoupled from the Koa context. Registered `asScoped`, so the instance
 * the service writes to is the same one the middleware reads via `ctx.container` within a request.
 */
@Injectable()
export class ResponseCookieJar {
    private pendingRefreshToken?: string;
    private pendingClearRefreshToken = false;

    setRefreshToken(token: string): void {
        this.pendingRefreshToken = token;
    }

    takeRefreshToken(): string | undefined {
        const token = this.pendingRefreshToken;
        this.pendingRefreshToken = undefined;
        return token;
    }

    clearRefreshToken(): void {
        this.pendingClearRefreshToken = true;
    }

    takeClearRefreshToken(): boolean {
        const clear = this.pendingClearRefreshToken;
        this.pendingClearRefreshToken = false;
        return clear;
    }
}
