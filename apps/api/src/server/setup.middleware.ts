import { Container } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { errorMiddleware, serverKitContextMiddleware, corsMiddleware, authenticationMiddleware, ServerKitMiddleware } from '@maroonedsoftware/koa';
import { RateLimiterMemory, RateLimiterRedis } from 'rate-limiter-flexible';
import { Redis } from 'ioredis';
import { auditContextMiddleware } from './middleware/audit.context.middleware.js';
import { authorizationContextMiddleware } from './middleware/authorization.context.middleware.js';
import { signedAudioMiddleware } from './middleware/signed.audio.middleware.js';
import { refreshCookieMiddleware } from './middleware/refresh.cookie.middleware.js';
import { conditionalGetMiddleware } from './middleware/conditional.get.middleware.js';
import { bridgeSecretMiddleware } from './middleware/bridge.secret.middleware.js';
import { hlsCorsMiddleware } from './middleware/hls.cors.middleware.js';
import { hlsHeartbeatMiddleware } from './middleware/hls.heartbeat.middleware.js';
import { rateLimitMiddleware } from './middleware/rate.limit.middleware.js';

export const setupMiddleware = (container: Container) => {
    const middlewares: ServerKitMiddleware[] = [];

    const redis = container.get(Redis);
    const config = container.get(AppConfig);

    // The Redis client runs with enableOfflineQueue:false, so a Redis outage makes consume()
    // reject — and the middleware turns any rejection into a 429, taking the whole API down as
    // "rate limited" during a blip. The in-memory insuranceLimiter lets rate limiting fall back
    // to per-instance memory when Redis is unreachable (fail-open, not fail-closed).
    const rateLimiter = new RateLimiterRedis({
        storeClient: redis,
        points: 100,
        duration: 5,
        insuranceLimiter: new RateLimiterMemory({
            points: 100,
            duration: 5,
        }),
    });

    middlewares.push(errorMiddleware());
    middlewares.push(serverKitContextMiddleware(container));
    // Ours rather than ServerKit's, for one reason: it keys on the real caller instead of on
    // `ctx.ip`, which behind nginx is the edge and therefore one bucket for every client at once.
    // See the middleware for why the trust is opted into and why it is not `app.proxy`.
    middlewares.push(rateLimitMiddleware(rateLimiter, config));
    // The web SDK sends every request with `credentials: 'include'` (to carry the httpOnly refresh
    // cookie cross-origin), so the API must answer with `Access-Control-Allow-Credentials: true` —
    // a credentialed response missing that header is blocked by the browser, which surfaced as
    // "We couldn't verify your session" when /me/sessions failed the CORS check. Credentialed CORS
    // forbids the `*` wildcard origin, so we allow explicit origins: the SPA and API base URLs.
    // An unset (or blank) base URL falls back to the empty default and drops out of the list.
    const allowedOrigins = [config.get<string, string>('SPA_BASE_URL', ''), config.get<string, string>('APP_BASE_URL', '')].filter(Boolean);
    // OUTSIDE the CORS middleware below, so its post-`next` write is the last one and overrides
    // that answer for the HLS prefix. The stream is a broadcast and any page may fetch it, which
    // is a different policy from the console's and cannot be a further entry in the list above:
    // that one is credentialed, and credentialed CORS forbids the `*` this needs. See the
    // middleware for why native playback hid this until a JavaScript player tried it.
    middlewares.push(hlsCorsMiddleware());
    middlewares.push(corsMiddleware({ origin: allowedOrigins, credentials: true, exposeHeaders: ['WWW-Authenticate'] }));
    // The gate on everything under /playout/bridge/. Both sides of this position are
    // load-bearing: AFTER the credential middleware, which is the only thing that puts
    // Icecast's HTTP-basic password onto the header this reads, and BEFORE authentication,
    // so a call with a wrong secret is refused without touching the session machinery.
    // Gating the prefix rather than each handler is what makes a new bridge route protected
    // by construction instead of by whoever remembers.
    middlewares.push(bridgeSecretMiddleware());
    // Counts an HLS listener off the playlist request they make anyway. Before authentication
    // because the route is anonymous — a player carries no session — and a tick that only
    // counted signed-in listeners would count nobody at all.
    middlewares.push(hlsHeartbeatMiddleware(config));
    middlewares.push(authenticationMiddleware());
    middlewares.push(auditContextMiddleware());
    // authorization.context collapses the auth package's context into the `Actor` union, checks the
    // actor still exists (a schema rebuild wipes Postgres and not Redis, so a browser can hold a
    // token for a user who does not), and resolves platform roles from the tuple store.
    //
    // It does NOT resolve an organization or pin any GUC, which is what this said for as long as it
    // existed. There is no organization table and no RLS to read one — see
    // `docs/todo/row-level-security.md`.
    middlewares.push(authorizationContextMiddleware());
    // The gate on the audio the player fetches: a URL signed with the bridge secret, or the read
    // floor a session would have met. After the authorization context because the second branch
    // needs the session it resolved, and before the routes because those three are `security: none`
    // in the contract for the bridge's reason — see the middleware for why the routes stay so.
    middlewares.push(signedAudioMiddleware());
    // Pushed after jsonMiddleware so its response-side hook runs INSIDE json's (Koa onion): it sees
    // the still-object token body, moves the refresh token into an httpOnly cookie, and strips it
    // before json serializes. No-op unless the client opted into cookie-based refresh.
    middlewares.push(refreshCookieMiddleware());
    // Last, so it is the innermost hook and sees the response a route actually produced. It exists
    // because ContractKit's generated routers pin their status, so no service can answer 304
    // itself; this turns a fresh 200 carrying an ETag into one. See the middleware for why it keys
    // off the ETag rather than off any particular route.
    middlewares.push(conditionalGetMiddleware());

    return middlewares;
};
