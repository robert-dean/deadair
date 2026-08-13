// Covers the one thing this middleware decides on its own authority: whether the session's
// subject is still a real actor. Sessions live in Redis and actors live in Postgres, so a
// database rebuild leaves the browser holding a token that verifies perfectly and names a user
// who is gone. Everything else the middleware does (shaping the Actor union) is exercised through
// the services that consume it.

import { describe, expect, it, vi } from 'vitest';
import { AuthenticationSessionService, invalidAuthenticationSession } from '@maroonedsoftware/authentication';
import { IsHttpError } from '@maroonedsoftware/errors';
import { ErrorCodes } from '@deadair/error-codes';

import { ActorsRepository } from '../../../src/modules/authentication/repositories/actors.repository.js';
import { AuthorizationContext } from '../../../src/modules/permissions/authorization.context.js';
import { DeadairPermissionsTupleRepository } from '../../../src/modules/permissions/permissions.repository.js';
import { PermissionsService } from '../../../src/modules/permissions/permissions.service.js';
import { REFRESH_COOKIE_NAME } from '../../../src/modules/authentication/refresh.cookie.js';
import { authorizationContextMiddleware } from '../../../src/server/middleware/authorization.context.middleware.js';

const ACTOR_ID = '11111111-1111-4111-8111-111111111111';

interface Harness {
    ctx: any;
    next: ReturnType<typeof vi.fn<() => Promise<void>>>;
    existsActive: ReturnType<typeof vi.fn>;
    deleteSession: ReturnType<typeof vi.fn>;
    cookieSet: ReturnType<typeof vi.fn>;
    overrides: Map<unknown, unknown>;
}

const harness = (options: { path?: string; actorExists?: boolean; relations?: string[] } = {}): Harness => {
    const existsActive = vi.fn().mockResolvedValue(options.actorExists ?? true);
    const deleteSession = vi.fn().mockResolvedValue(undefined);
    const cookieSet = vi.fn();
    const next = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const overrides = new Map<unknown, unknown>();

    const registry = new Map<unknown, unknown>([
        [ActorsRepository, { existsActive }],
        [AuthenticationSessionService, { deleteSession }],
        [PermissionsService, {}],
        [DeadairPermissionsTupleRepository, { listRelationsForSubjectOnObject: vi.fn().mockResolvedValue(options.relations ?? []) }],
    ]);

    const ctx = {
        path: options.path ?? '/plugins/rescan',
        requestId: 'req-1',
        ipAddress: '203.0.113.1',
        request: { headers: {} },
        cookies: { set: cookieSet, get: vi.fn() },
        authenticationSession: {
            sessionToken: 'session-token',
            subject: ACTOR_ID,
            claims: { actorType: 'user' },
            factors: [],
        },
        container: {
            get: (token: unknown) => registry.get(token),
            override: (token: unknown, value: unknown) => overrides.set(token, value),
        },
    };

    return { ctx, next, existsActive, deleteSession, cookieSet, overrides };
};

describe('authorizationContextMiddleware', () => {
    it('builds a user actor when the session subject is still a live actor', async () => {
        const h = harness({ relations: ['admin'] });

        await authorizationContextMiddleware()(h.ctx, h.next);

        expect(h.existsActive).toHaveBeenCalledWith(ACTOR_ID);
        expect(h.next).toHaveBeenCalledOnce();
        const context = h.overrides.get(AuthorizationContext) as AuthorizationContext;
        expect(context.actor.kind).toBe('user');
        expect(context.actor.kind === 'user' && [...context.actor.platformRoles]).toEqual(['admin']);
    });

    it('rejects with 401 when the session outlived its actor, rather than letting it through roleless', async () => {
        const h = harness({ actorExists: false });

        // A roleless pass-through would surface as a 403 from whichever policy the route names,
        // which reads as "you lack a permission" when the truth is "you are nobody".
        const error = await authorizationContextMiddleware()(h.ctx, h.next).catch((e: unknown) => e);

        expect(IsHttpError(error) && error.statusCode).toBe(401);
        expect(IsHttpError(error) && (error.details as { code?: string }).code).toBe(ErrorCodes.SESSION_ACTOR_MISSING);
        expect(h.next).not.toHaveBeenCalled();
    });

    it('revokes the dead session and clears the refresh cookie so the token stops coming back', async () => {
        const h = harness({ actorExists: false });

        await authorizationContextMiddleware()(h.ctx, h.next).catch(() => undefined);

        expect(h.deleteSession).toHaveBeenCalledWith('session-token', 'expiry');
        expect(h.cookieSet).toHaveBeenCalledWith(REFRESH_COOKIE_NAME, null, expect.objectContaining({ maxAge: 0 }));
    });

    it('lets a stale token through on the session-bootstrap routes, so a login can replace it', async () => {
        const h = harness({ path: '/auth/token', actorExists: false });

        await authorizationContextMiddleware()(h.ctx, h.next);

        expect(h.next).toHaveBeenCalledOnce();
        expect(h.existsActive).not.toHaveBeenCalled();
    });

    it('leaves the unauthenticated path alone — there is no subject to check', async () => {
        const h = harness({ actorExists: false });
        h.ctx.authenticationSession = invalidAuthenticationSession;

        await authorizationContextMiddleware()(h.ctx, h.next);

        expect(h.next).toHaveBeenCalledOnce();
        expect(h.existsActive).not.toHaveBeenCalled();
        expect((h.overrides.get(AuthorizationContext) as AuthorizationContext).actor.kind).toBe('system');
    });
});
