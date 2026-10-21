import { Injectable } from 'injectkit';

/**
 * Request-scoped holder for the cookies a browser client presented that a service needs to read:
 *  - the refresh token, as an httpOnly cookie (see refresh.cookie.ts). The refresh grant reads it
 *    when the request body carries no `refresh_token`;
 *  - the `state` of the identity-provider sign-in this browser started (see oidc.state.cookie.ts),
 *    which the OIDC callback holds the returning `state` to.
 *
 * refreshCookieMiddleware reads both off the Koa context on the way in and stashes them here,
 * keeping services decoupled from the Koa context. Registered `asScoped`, so the instance the
 * middleware writes via `ctx.container` is the same one the service reads within a request.
 */
@Injectable()
export class RequestCookieJar {
    private refreshToken?: string;
    private oidcState?: string;

    setRefreshToken(token: string): void {
        this.refreshToken = token;
    }

    getRefreshToken(): string | undefined {
        return this.refreshToken;
    }

    setOidcState(state: string): void {
        this.oidcState = state;
    }

    getOidcState(): string | undefined {
        return this.oidcState;
    }
}
