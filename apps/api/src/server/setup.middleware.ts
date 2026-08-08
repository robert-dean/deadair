import { Container } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import {
    errorMiddleware,
    serverKitContextMiddleware,
    corsMiddleware,
    rateLimiterMiddleware,
    authenticationMiddleware,
    ServerKitMiddleware,
} from '@maroonedsoftware/koa';
import { RateLimiterMemory, RateLimiterRedis } from 'rate-limiter-flexible';
import { Redis } from 'ioredis';
import { auditContextMiddleware } from './middleware/audit.context.middleware.js';
import { authorizationContextMiddleware } from './middleware/authorization.context.middleware.js';
import { refreshCookieMiddleware } from './middleware/refresh.cookie.middleware.js';
import { conditionalGetMiddleware } from './middleware/conditional.get.middleware.js';
import { listenerCredentialMiddleware } from './middleware/listener.credential.middleware.js';

export const setupMiddleware = (container: Container) => {
    const middlewares: ServerKitMiddleware[] = [];

    const redis = container.get(Redis);
    const config = container.get(AppConfig);

    // The Redis client runs with enableOfflineQueue:false, so a Redis outage makes consume()
    // reject — and rateLimiterMiddleware turns any rejection into a 429, taking the whole API
    // down as "rate limited" during a blip. The in-memory insuranceLimiter lets rate limiting
    // fall back to per-instance memory when Redis is unreachable (fail-open, not fail-closed).
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
    middlewares.push(rateLimiterMiddleware(rateLimiter));
    // The web SDK sends every request with `credentials: 'include'` (to carry the httpOnly refresh
    // cookie cross-origin), so the API must answer with `Access-Control-Allow-Credentials: true` —
    // a credentialed response missing that header is blocked by the browser, which surfaced as
    // "We couldn't verify your session" when /me/sessions failed the CORS check. Credentialed CORS
    // forbids the `*` wildcard origin, so we allow explicit origins: the SPA and API base URLs.
    // An unset (or blank) base URL falls back to the empty default and drops out of the list.
    const allowedOrigins = [config.get<string, string>('SPA_BASE_URL', ''), config.get<string, string>('APP_BASE_URL', '')].filter(Boolean);
    middlewares.push(corsMiddleware({ origin: allowedOrigins, credentials: true, exposeHeaders: ['WWW-Authenticate'] }));
    // Strictly BEFORE authentication, which deletes the Authorization header from every
    // request: this is the one caller that presents its credential there and is not a
    // session. See the middleware for why Icecast has no other way to send it.
    middlewares.push(listenerCredentialMiddleware());
    middlewares.push(authenticationMiddleware());
    middlewares.push(auditContextMiddleware());
    // authorization.context resolves the active org (validating any
    // `x-organization-id` header against the user's actual memberships) and
    // pins `app.actor_org_id` on the active transaction so identity's RLS
    // policies can read it.
    middlewares.push(authorizationContextMiddleware());
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
