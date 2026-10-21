import type { Context } from 'koa';
import { cookieOptions, withScheme } from './refresh.cookie.js';

/**
 * The `state` of the identity-provider sign-in (or link) this browser started, held as an httpOnly
 * cookie so the callback can refuse one the browser did not start.
 *
 * `OidcFactorService.completeAuthorization` trusts whichever stored state record the callback's
 * `state` names, and the PKCE verifier and nonce live in that record, so neither proves anything
 * about the browser. Without this an attacker could begin a sign-in, stop at the provider's
 * redirect, and hand the callback URL to somebody else, whose console would then be signed in as
 * the attacker. A link is the same with worse consequences: the victim's identity would land on the
 * attacker's account.
 *
 * SameSite=Lax is enough because the provider returns the browser with a top-level GET. One cookie
 * holds one state, so a second sign-in started in another tab replaces the first and the first one's
 * callback is refused and asks to start again.
 */
export const OIDC_STATE_COOKIE_NAME = 'deadair.oidc';

export const setOidcStateCookie = (ctx: Context, state: string, maxAgeMs: number): void => {
    const options = cookieOptions(ctx);

    withScheme(ctx, options.secure).set(OIDC_STATE_COOKIE_NAME, state, { ...options, maxAge: maxAgeMs });
};

export const readOidcStateCookie = (ctx: Context): string | undefined => ctx.cookies.get(OIDC_STATE_COOKIE_NAME);

export const clearOidcStateCookie = (ctx: Context): void => {
    const options = cookieOptions(ctx);

    withScheme(ctx, options.secure).set(OIDC_STATE_COOKIE_NAME, null, { ...options, maxAge: 0 });
};
