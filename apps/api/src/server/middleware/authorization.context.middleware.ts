import { ErrorCodes } from '@deadair/error-codes';
import type { ScopedContainer } from 'injectkit';
import { Kysely, sql } from 'kysely';
import { ServerKitMiddleware } from '@maroonedsoftware/koa';
import { httpError } from '@maroonedsoftware/errors';
import { invalidAuthenticationSession } from '@maroonedsoftware/authentication';
import { AuthorizationContext, type Actor } from '#modules/permissions/authorization.context.js';
import { DB } from '#modules/data/db.js';
import { PermissionsService } from '#modules/permissions/permissions.service.js';
import { DeadairPermissionsTupleRepository } from '#modules/permissions/permissions.repository.js';
import {
    PLATFORM_NAMESPACE,
    PLATFORM_OBJECT_ID,
    isPlatformRoleName,
    rolesGrant,
    type PlatformRoleName,
} from '#modules/permissions/platform.roles.js';

// `@maroonedsoftware/authentication` exposes a flat `AuthenticationContext`:
// `{ actorId, actorType, claims, roles, factors, ... }`. We collapse it into
// our Actor union here. The JWT issuer emits `actorType: 'user'` for human
// logins; everything else (jobs, CLI, webhooks) goes through the
// unauthenticated branch and is classified as system or vendor.

const stringClaim = (claims: Record<string, unknown> | undefined, key: string): string | undefined => {
    if (!claims) return undefined;
    const v = claims[key];
    return typeof v === 'string' ? v : undefined;
};

const isWebhookPath = (p: string) => p.startsWith('/webhooks/');

const deriveRolePermissions = (canManage: boolean, canEdit: boolean, canView: boolean): ReadonlySet<string> => {
    if (canManage) return new Set(['platform:view', 'platform:edit', 'platform:manage']);
    if (canEdit) return new Set(['platform:view', 'platform:edit']);
    if (canView) return new Set(['platform:view']);
    return new Set();
};

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
            const permissions = container.get(PermissionsService);
            const tupleRepo = container.get(DeadairPermissionsTupleRepository);
            const actorId = auth.subject;

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
                rolePermissions: new Set(),
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
