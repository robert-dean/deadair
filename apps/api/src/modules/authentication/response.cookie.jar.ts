import { Injectable } from 'injectkit';
import { DateTime } from 'luxon';

/** An identity-provider sign-in's `state`, and when the station stops honouring it. */
export interface PendingOidcState {
    state: string;
    expiresAt: DateTime;
}

/**
 * Request-scoped holder for cookie writes a service wants performed on the way out:
 *  - a refresh token that a server-rendered flow (e.g. invitation-accept, which returns an HTML
 *    redirect, not a JSON body) wants delivered as an httpOnly cookie;
 *  - a request to clear the cookie (logout);
 *  - the `state` of an identity-provider sign-in or link this request began, bound to the browser
 *    (see oidc.state.cookie.ts), and a request to clear it once its callback has used it.
 *
 * The service sets it; refreshCookieMiddleware drains it on the way out and writes/clears the
 * cookies — keeping services decoupled from the Koa context. Registered `asScoped`, so the instance
 * the service writes to is the same one the middleware reads via `ctx.container` within a request.
 */
@Injectable()
export class ResponseCookieJar {
    private pendingRefreshToken?: string;
    private pendingClearRefreshToken = false;
    private pendingOidcState?: PendingOidcState;
    private pendingClearOidcState = false;

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

    setOidcState(state: string, expiresAt: DateTime): void {
        this.pendingOidcState = { state, expiresAt };
    }

    takeOidcState(): PendingOidcState | undefined {
        const pending = this.pendingOidcState;
        this.pendingOidcState = undefined;
        return pending;
    }

    clearOidcState(): void {
        this.pendingClearOidcState = true;
    }

    takeClearOidcState(): boolean {
        const clear = this.pendingClearOidcState;
        this.pendingClearOidcState = false;
        return clear;
    }
}
