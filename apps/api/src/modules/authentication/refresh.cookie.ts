import type { Context } from 'koa';

// Cookie-based refresh tokens. A web client opts in by sending REFRESH_COOKIE_OPT_IN_HEADER on its
// auth requests; the server then delivers the refresh token as an httpOnly cookie (never readable by
// JS, so immune to XSS exfiltration) instead of in the JSON body, and the /auth/refresh + /auth/logout
// endpoints read/clear it. Non-web clients (mobile, server-to-server) omit the header and keep the
// body-token behavior unchanged.

export const REFRESH_COOKIE_NAME = 'crescenda.rt';

// Presence of this header (any value) on a request signals the client wants cookie-based refresh.
export const REFRESH_COOKIE_OPT_IN_HEADER = 'x-crescenda-refresh-cookie';

// Refresh cookie lifetime. Should be >= the refresh token's own TTL so the browser doesn't drop a
// still-valid token; the token itself remains the authority (an expired token is rejected on refresh).
const REFRESH_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export const wantsRefreshCookie = (ctx: Context): boolean => ctx.get(REFRESH_COOKIE_OPT_IN_HEADER) !== '';

const cookieOptions = () => ({
    httpOnly: true,
    // Secure in production; allow http in local dev. With the web app served same-origin (via the
    // Vite dev proxy) SameSite=Lax is sufficient and avoids third-party-cookie handling.
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    overwrite: true,
});

export const setRefreshCookie = (ctx: Context, refreshToken: string): void => {
    ctx.cookies.set(REFRESH_COOKIE_NAME, refreshToken, { ...cookieOptions(), maxAge: REFRESH_COOKIE_MAX_AGE_MS });
};

export const readRefreshCookie = (ctx: Context): string | undefined => ctx.cookies.get(REFRESH_COOKIE_NAME);

export const clearRefreshCookie = (ctx: Context): void => {
    // Setting the value to null with maxAge 0 expires the cookie. Same attributes as when set, so the
    // browser matches and removes it.
    ctx.cookies.set(REFRESH_COOKIE_NAME, null, { ...cookieOptions(), maxAge: 0 });
};
