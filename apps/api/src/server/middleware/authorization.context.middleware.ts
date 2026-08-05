import { ErrorCodes } from '@deadair/error-codes';
import type { ScopedContainer } from 'injectkit';
import { ServerKitMiddleware } from '@maroonedsoftware/koa';
import { httpError } from '@maroonedsoftware/errors';
import { AuthenticationSessionService, invalidAuthenticationSession } from '@maroonedsoftware/authentication';
import { ActorsRepository } from '#modules/authentication/repositories/actors.repository.js';
import { clearRefreshCookie } from '#modules/authentication/refresh.cookie.js';
import { AuthorizationContext, type Actor } from '#modules/permissions/authorization.context.js';
import { DeadairPermissionsTupleRepository } from '#modules/permissions/permissions.repository.js';
import { PLATFORM_NAMESPACE, PLATFORM_OBJECT_ID, isPlatformRoleName, type PlatformRoleName } from '#modules/permissions/platform.roles.js';

// `@maroonedsoftware/authentication` exposes a flat `AuthenticationContext`:
// `{ actorId, actorType, claims, roles, factors, ... }`. We collapse it into
// our Actor union here. The JWT issuer emits `actorType: 'user'` for human
// logins; everything else (jobs, CLI, webhooks) goes through the
// unauthenticated branch and is classified as system or vendor.

const isWebhookPath = (p: string) => p.startsWith('/webhooks/');

// Routes whose whole job is to establish or tear down a session. A stale token presented to one of
// them must not be fatal: the browser attaches whatever it still holds to every request, so failing
// the actor check here would 401 the very login that replaces the dead session, and the operator
// could never talk their way back in without clearing storage by hand.
const isSessionBootstrapPath = (p: string) => p === '/auth/token' || p === '/auth/logout' || p.startsWith('/auth/login/');

export const authorizationContextMiddleware: () => ServerKitMiddleware = () => {
    return async (ctx, next) => {
        const container = ctx.container as ScopedContainer;
        const auth = ctx.authenticationSession;
        const sessionToken = auth.sessionToken ?? '';

        let actor: Actor;

        // `@maroonedsoftware/authentication` always assigns a session — for
        // unauthenticated requests it assigns the `invalidAuthenticationSession`
        // sentinel rather than `undefined`. Reference equality with the sentinel
        // is the canonical way to detect "unauthenticated"; a truthiness check
        // would never fire because the sentinel is a populated object.
        if (auth === invalidAuthenticationSession) {
            actor = isWebhookPath(ctx.path)
                ? {
                      kind: 'vendor',
                      sessionToken,
                      vendor: ctx.path.split('/')[2] ?? 'unknown',
                      eventId: ctx.requestId ?? '',
                  }
                : { kind: 'system', sessionToken, source: 'http' };
        } else if (auth.claims.actorType === 'user') {
            const tupleRepo = container.get(DeadairPermissionsTupleRepository);
            const actorId = auth.subject;

            // Sessions live in Redis, actors live in Postgres, and the two can diverge: a database
            // rebuild drops every actor while the browser's httpOnly refresh cookie and its Redis
            // session sail straight through it. The resulting token still verifies and still names
            // a subject, so without this check the request continues as a user who no longer
            // exists — one that holds no tuples, and therefore silently fails every permission
            // gate with a 403 instead of the 401 that would send the client to the login screen.
            // Revoke the session rather than merely rejecting it, so the dead token stops coming
            // back, and clear the cookie directly: refreshCookieMiddleware runs inside this one, so
            // the ResponseCookieJar it drains never gets the chance when we throw here.
            if (!isSessionBootstrapPath(ctx.path) && (!actorId || !(await container.get(ActorsRepository).existsActive(actorId)))) {
                await container
                    .get(AuthenticationSessionService)
                    .deleteSession(sessionToken, 'expiry')
                    .catch(() => undefined);
                clearRefreshCookie(ctx);
                throw httpError(401)
                    .withDetails({ code: ErrorCodes.SESSION_ACTOR_MISSING, message: 'the session refers to an actor that no longer exists' })
                    .withInternalDetails({ message: `session ${sessionToken} names missing or inactive actor ${actorId ?? '(none)'}` });
            }

            let platformRoles: ReadonlySet<PlatformRoleName> = new Set();
            if (actorId) {
                const userSubject = { kind: 'concrete' as const, namespace: 'user', id: actorId };
                const roleRelations = await tupleRepo.listRelationsForSubjectOnObject(
                    { namespace: PLATFORM_NAMESPACE, id: PLATFORM_OBJECT_ID },
                    userSubject,
                );
                platformRoles = new Set(roleRelations.filter(isPlatformRoleName));
            }

            actor = {
                kind: 'user',
                sessionToken,
                actorId,
                platformRoles,
                factors: auth.factors,
            };
        } else {
            // Unknown actorType. Classified as an `http`-sourced system actor,
            // which `AccessControlService` denies object-level access rather
            // than trusting: this is a request it could not resolve to a user,
            // not a trusted subsystem call.
            actor = { kind: 'system', sessionToken, source: 'http', actorId: auth.subject };
        }

        container.override(
            AuthorizationContext,
            new AuthorizationContext(actor, {
                requestId: ctx.requestId,
                ipAddress: ctx.ipAddress ?? undefined,
                userAgent: ctx.request.headers['user-agent'] as string | undefined,
            }),
        );

        await next();
    };
};
