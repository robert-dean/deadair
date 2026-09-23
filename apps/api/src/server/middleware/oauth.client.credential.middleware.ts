import type { ServerKitMiddleware } from '@maroonedsoftware/koa';

/** Where the token endpoint finds a client's HTTP Basic credential, set aside by the middleware below. */
export const OAUTH_CLIENT_AUTHORIZATION = 'oauthClientAuthorization';

/** The token endpoint, as the router would match it: any case, with or without a trailing slash. */
const isTokenPath = (path: string): boolean => path.replace(/\/+$/, '').toLowerCase() === '/auth/oauth/token';

/**
 * Sets aside a client's `Authorization: Basic ...` sent to the OAuth token endpoint, before the
 * authentication middleware deletes the header.
 *
 * RFC 6749 §2.3.1 lets a confidential client authenticate to the token endpoint with HTTP Basic, and
 * `client_secret_basic` is one of the methods the station advertises. ServerKit's authentication
 * middleware removes `Authorization` from every request before any route runs, so it cannot leak into
 * a log, which left the token endpoint with nothing to read. It is copied onto `ctx.state` for that
 * one path and removed from the request here, so the scheme handler, which knows no `basic`, never
 * sees it either. A Bearer header, or any header on any other path, is left for the authentication
 * middleware as before.
 */
export const oauthClientCredentialMiddleware = (): ServerKitMiddleware => {
    return async (ctx, next) => {
        const header = ctx.req.headers.authorization;
        if (typeof header === 'string' && /^basic\s/i.test(header) && isTokenPath(ctx.path)) {
            (ctx.state as Record<string, unknown>)[OAUTH_CLIENT_AUTHORIZATION] = header;
            delete ctx.req.headers.authorization;
        }
        await next();
    };
};
