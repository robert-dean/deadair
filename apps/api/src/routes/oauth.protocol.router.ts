import { AppConfig } from '@maroonedsoftware/appconfig';
import { IsOAuthError, OAuthAuthorizationServer } from '@maroonedsoftware/authentication';
import { httpError } from '@maroonedsoftware/errors';
import { ServerKitRouter, bodyParserMiddleware, type ServerKitContext, type ServerKitRouterMiddleware } from '@maroonedsoftware/koa';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { MCP_PATH, OAuthOptions } from '#modules/oauth/oauth.options.js';
import { oauthIsEnabled } from '#modules/oauth/oauth.settings.js';
import { rateLimitMiddleware } from '#src/server/middleware/rate.limit.middleware.js';
import { OAUTH_CLIENT_AUTHORIZATION } from '#src/server/middleware/oauth.client.credential.middleware.js';

/**
 * The station's OAuth endpoints that the RFCs fix the shape of: the two discovery documents, dynamic
 * client registration, and the token endpoint.
 *
 * **The one router in this folder that is not generated, and why.** ContractKit pins one success
 * status per operation and ServerKit renders a thrown error as `{ statusCode, message, details }`,
 * where RFC 6749 wants `{ error, error_description }` from the token endpoint and RFC 7591 a 201 with
 * its own error body from registration. A generated route could produce neither. What the console
 * calls (consent, clients, grants) IS generated, from `data/contracts/oauth`.
 *
 * The flow is the library's (`OAuthAuthorizationServer`); every handler here is a line or two. While
 * OAuth is switched off, or on a station with no public address to be an issuer at, every one answers
 * 404 and resolves nothing, so a station that never turned it on looks exactly as it did.
 *
 * The discovery documents are at the ORIGIN (see `OAuthOptions`), which every edge forwards here
 * with the path kept; the two POSTs are under `/api` like everything else.
 */
export const OAuthProtocolRouter = ServerKitRouter();

/** The authorization server, or a 404 when there is none to answer for. */
function serverFor(ctx: ServerKitContext): OAuthAuthorizationServer {
    const config = ctx.container.get(AppConfig);
    if (!oauthIsEnabled(config) || OAuthOptions.fromConfig(config) === undefined) throw httpError(404);
    return ctx.container.get(OAuthAuthorizationServer);
}

/** An `OAuthError` as RFC 6749 §5.2 renders it; anything else is the error middleware's. */
function renderOAuthError(ctx: ServerKitContext, error: unknown): void {
    if (!IsOAuthError(error)) throw error;
    ctx.status = error.statusCode;
    for (const [name, value] of Object.entries(error.headers ?? {})) ctx.set(name, value);
    ctx.type = 'application/json';
    ctx.body = error.toBody();
}

/**
 * Tighter than the station-wide limit, per caller: registration writes a row per call, and the token
 * endpoint is where a guessed code or a stolen refresh token is tried. Claude registers once per
 * connection and refreshes at most every few minutes, so twenty a minute is far above any honest
 * use. In memory, because the station is one process.
 */
const oauthLimiter = new RateLimiterMemory({ points: 20, duration: 60 });
const limitOAuth: ServerKitRouterMiddleware = async (ctx, next) => {
    await rateLimitMiddleware(oauthLimiter, ctx.container.get(AppConfig))(ctx, next);
};

const authorizationServerMetadata: ServerKitRouterMiddleware = async ctx => {
    ctx.type = 'application/json';
    ctx.body = serverFor(ctx).metadata();
};

const protectedResourceMetadata: ServerKitRouterMiddleware = async ctx => {
    const server = serverFor(ctx);
    const oauth = OAuthOptions.fromConfig(ctx.container.get(AppConfig));
    const metadata = oauth === undefined ? undefined : server.resourceMetadata(oauth.resource);
    if (metadata === undefined) throw httpError(404);
    ctx.type = 'application/json';
    ctx.body = metadata;
};

// RFC 8414 §3: the issuer is the origin, so this is its metadata's only address.
OAuthProtocolRouter.get('/.well-known/oauth-authorization-server', authorizationServerMetadata);

// RFC 9728 §3: the path-inserted form is what the MCP endpoint's 401 names; the root form is what a
// client tries when it has no challenge to read. One resource, so both answer the same document.
OAuthProtocolRouter.get(`/.well-known/oauth-protected-resource/api${MCP_PATH}`, protectedResourceMetadata);
OAuthProtocolRouter.get('/.well-known/oauth-protected-resource', protectedResourceMetadata);

// RFC 7591: an app registering itself. JSON only, as the RFC says; 201 with the registration.
OAuthProtocolRouter.post('/auth/oauth/register', limitOAuth, bodyParserMiddleware(['json']), async ctx => {
    const server = serverFor(ctx);
    try {
        const { response } = await server.register(ctx.parsedBody);
        ctx.status = 201;
        ctx.type = 'application/json';
        ctx.body = response;
    } catch (error) {
        renderOAuthError(ctx, error);
    }
});

// RFC 6749 §3.2: form-encoded is the standard, and what Claude sends; JSON is accepted as well.
// Never cached, per §5.1.
OAuthProtocolRouter.post('/auth/oauth/token', limitOAuth, bodyParserMiddleware(['urlencoded', 'json']), async ctx => {
    const server = serverFor(ctx);
    ctx.set('Cache-Control', 'no-store');
    ctx.set('Pragma', 'no-cache');
    try {
        const body = (ctx.parsedBody ?? {}) as Record<string, unknown>;
        ctx.type = 'application/json';
        // The authentication middleware has deleted `Authorization` by now; a Basic credential was
        // set aside for this route before it did (oauth.client.credential.middleware).
        const authorization = (ctx.state as Record<string, unknown>)[OAUTH_CLIENT_AUTHORIZATION];
        ctx.body = await server.token(body, typeof authorization === 'string' ? { authorization } : {});
    } catch (error) {
        renderOAuthError(ctx, error);
    }
});
