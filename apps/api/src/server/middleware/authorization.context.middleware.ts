import { ErrorCodes } from '@deadair/error-codes';
import type { ScopedContainer } from 'injectkit';
import { ServerKitMiddleware } from '@maroonedsoftware/koa';
import { httpError } from '@maroonedsoftware/errors';
import {
    AuthenticationSessionService,
    getApiKeyClaim,
    invalidAuthenticationSession,
    type ApiKeySessionClaim,
} from '@maroonedsoftware/authentication';
import { CacheProvider } from '@maroonedsoftware/cache';
import { Logger } from '@maroonedsoftware/logger';
import { ActorsRepository } from '#modules/authentication/repositories/actors.repository.js';
import { LoginActivityRepository } from '#modules/authentication/repositories/login.activity.repository.js';
import { APIKEY_NAMESPACE } from '#modules/authentication/repositories/apikey.factor.repository.js';
import { API_KEY_GRANTS, type ApiKeyGrant } from '#modules/authentication/api.key.scopes.js';
import { API_KEY_USE_WINDOW } from '#modules/authentication/api.key.options.js';
import { clearRefreshCookie } from '#modules/authentication/refresh.cookie.js';
import { AuthorizationContext, type Actor, type UserActor } from '#modules/permissions/authorization.context.js';
import { DeadairPermissionsTupleRepository } from '#modules/permissions/permissions.repository.js';
import { PermissionsService } from '#modules/permissions/permissions.service.js';
import { PLATFORM_NAMESPACE, PLATFORM_OBJECT_ID, isPlatformRoleName, type PlatformRoleName } from '#modules/permissions/platform.roles.js';
import { errorText } from '#modules/shared/error.text.js';
import { runInTrace } from '#modules/shared/trace.context.js';
import type { ServerKitContext } from '@maroonedsoftware/koa';

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

/** Longest User-Agent stored against a key's use, as for a sign-in. */
const MAX_USER_AGENT_LEN = 512;

/** The platform roles a user holds, read once per request from their tuples on `platform:main`. */
const loadPlatformRoles = async (container: ScopedContainer, actorId: string): Promise<ReadonlySet<PlatformRoleName>> => {
    const roleRelations = await container
        .get(DeadairPermissionsTupleRepository)
        .listRelationsForSubjectOnObject(
            { namespace: PLATFORM_NAMESPACE, id: PLATFORM_OBJECT_ID },
            { kind: 'concrete', namespace: 'user', id: actorId },
        );
    return new Set(roleRelations.filter(isPlatformRoleName));
};

/**
 * What the key may do, asked of the permissions model once per request for the same reason the
 * roles are: the policies read it from the actor, and must not re-walk the tuples on every gated
 * route. Each answer already intersects the owner's roles with the key's scope (`apikey` in
 * `core.perm`), so a key whose owner lost a role loses it here on the very next request.
 */
const loadApiKeyGrants = async (container: ScopedContainer, keyId: string, actorId: string): Promise<ReadonlySet<ApiKeyGrant>> => {
    const permissions = container.get(PermissionsService);
    const subject = { kind: 'concrete' as const, namespace: 'user', id: actorId };
    const held = await Promise.all(
        API_KEY_GRANTS.map(async grant =>
            (await permissions.checkSubject({ namespace: APIKEY_NAMESPACE, id: keyId }, grant, subject)) ? grant : undefined,
        ),
    );
    return new Set(held.filter((grant): grant is ApiKeyGrant => grant !== undefined));
};

/**
 * Record that a key was used, at most once per window, as a `login_events` row carrying the caller's
 * address. Here rather than in the repository's `touchLastUsed`, because ServerKit calls that from
 * inside `authenticationMiddleware`, before any of this request's context exists. Best effort: a
 * cache or database blip must not turn a good key into a failed request.
 */
const recordApiKeyUse = async (container: ScopedContainer, ctx: ServerKitContext, claim: ApiKeySessionClaim): Promise<void> => {
    try {
        const claimed = await container.get(CacheProvider).add(`apikey_use_${claim.id}`, '1', { ttl: API_KEY_USE_WINDOW });
        if (!claimed) return;
        const userAgent = ctx.request.headers['user-agent'] as string | undefined;
        await container.get(LoginActivityRepository).insertLogin({
            actorId: claim.owner.actorId,
            factorType: 'apikey',
            factorId: claim.id,
            sessionToken: null,
            ip: ctx.ipAddress ?? null,
            userAgent: userAgent ? userAgent.slice(0, MAX_USER_AGENT_LEN) : null,
            mfaSatisfied: false,
        });
    } catch (err) {
        container.get(Logger).warn('auth: failed to record an API key use', { error: errorText(err), keyId: claim.id });
    }
};

/**
 * A request made with a personal API key, as its owner narrowed to what the key was granted.
 *
 * The owner's liveness is checked on EVERY path, bootstrap routes included, because the reason those
 * are exempt for a session (a browser re-presenting a dead token to the route that replaces it) has
 * no counterpart for a key. Nothing is revoked and no cookie is cleared on the way out: the session
 * ServerKit minted references nothing stored, and any refresh cookie on the request belongs to a
 * signed-in session that is not this one.
 */
const apiKeyActor = async (
    container: ScopedContainer,
    ctx: ServerKitContext,
    claim: ApiKeySessionClaim,
    sessionToken: string,
): Promise<UserActor> => {
    const actorId = claim.owner.actorId;
    if (!(await container.get(ActorsRepository).existsActive(actorId))) {
        throw httpError(401)
            .withDetails({ code: ErrorCodes.SESSION_ACTOR_MISSING, message: 'the API key belongs to an account that no longer exists' })
            .withInternalDetails({ message: `api key ${claim.id} names missing or inactive actor ${actorId}` });
    }

    const [platformRoles, grants] = await Promise.all([loadPlatformRoles(container, actorId), loadApiKeyGrants(container, claim.id, actorId)]);
    await recordApiKeyUse(container, ctx, claim);

    return {
        kind: 'user',
        sessionToken,
        actorId,
        platformRoles,
        factors: [],
        apiKey: { id: claim.id, name: claim.name, grants },
    };
};

export const authorizationContextMiddleware: () => ServerKitMiddleware = () => {
    return async (ctx, next) => {
        const container = ctx.container as ScopedContainer;
        const auth = ctx.authenticationSession;
        const sessionToken = auth.sessionToken ?? '';
        const apiKeyClaim = auth === invalidAuthenticationSession ? undefined : getApiKeyClaim(auth);

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
        } else if (apiKeyClaim && apiKeyClaim.owner.kind === 'user') {
            actor = await apiKeyActor(container, ctx, apiKeyClaim, sessionToken);
        } else if (auth.claims.actorType === 'user') {
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

            const platformRoles: ReadonlySet<PlatformRoleName> = actorId ? await loadPlatformRoles(container, actorId) : new Set();

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

        // The request half of the trace root, using the same `ctx.requestId` handed to the envelope
        // one line above. Here rather than in its own middleware because this is where the id is
        // already being read, and a second middleware whose only job was to re-read it would be one
        // more thing to get the order of wrong. Everything downstream of `next()` — the route, the
        // services it resolves, the plugins they invoke — answers this trace.
        //
        // `kind` is the method and path rather than the matched route, which would be better and is
        // not reachable from here: routing has not happened yet. A path with an id in it is still
        // the right decision to have named, and a reader searching by id never sees this field.
        await runInTrace({ id: ctx.requestId, kind: `${ctx.method} ${ctx.path}` }, async () => await next());
    };
};
