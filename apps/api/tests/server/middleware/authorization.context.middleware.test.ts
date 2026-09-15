// Covers the one thing this middleware decides on its own authority: whether the session's
// subject is still a real actor. Sessions live in Redis and actors live in Postgres, so a
// database rebuild leaves the browser holding a token that verifies perfectly and names a user
// who is gone. Everything else the middleware does (shaping the Actor union) is exercised through
// the services that consume it.

import { describe, expect, it, vi } from 'vitest';
import { AuthenticationSessionService, invalidAuthenticationSession } from '@maroonedsoftware/authentication';
import { IsHttpError } from '@maroonedsoftware/errors';
import { ErrorCodes } from '@deadair/error-codes';

import { AppConfig } from '@maroonedsoftware/appconfig';
import { CacheProvider } from '@maroonedsoftware/cache';
import { Logger } from '@maroonedsoftware/logger';

import { ActorsRepository } from '../../../src/modules/authentication/repositories/actors.repository.js';
import { LoginActivityRepository } from '../../../src/modules/authentication/repositories/login.activity.repository.js';
import { AuthorizationContext } from '../../../src/modules/permissions/authorization.context.js';
import { DeadairPermissionsTupleRepository } from '../../../src/modules/permissions/permissions.repository.js';
import { PermissionsService } from '../../../src/modules/permissions/permissions.service.js';
import { REFRESH_COOKIE_NAME } from '../../../src/modules/authentication/refresh.cookie.js';
import { authorizationContextMiddleware } from '../../../src/server/middleware/authorization.context.middleware.js';
import { currentTrace } from '../../../src/modules/shared/trace.context.js';

const ACTOR_ID = '11111111-1111-4111-8111-111111111111';

interface Harness {
    ctx: any;
    next: ReturnType<typeof vi.fn<() => Promise<void>>>;
    existsActive: ReturnType<typeof vi.fn>;
    deleteSession: ReturnType<typeof vi.fn>;
    cookieSet: ReturnType<typeof vi.fn>;
    overrides: Map<unknown, unknown>;
}

interface HarnessOptions {
    path?: string;
    method?: string;
    actorExists?: boolean;
    relations?: string[];
    /** What the permissions model answers for the key's own object, per grant. */
    keyGrants?: string[];
    /** Whether this request is the first in the key's use window. */
    firstInWindow?: boolean;
}

const harness = (options: HarnessOptions = {}): Harness & { checkSubject: ReturnType<typeof vi.fn>; insertLogin: ReturnType<typeof vi.fn> } => {
    const existsActive = vi.fn().mockResolvedValue(options.actorExists ?? true);
    const deleteSession = vi.fn().mockResolvedValue(undefined);
    const cookieSet = vi.fn();
    const next = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const overrides = new Map<unknown, unknown>();
    const checkSubject = vi.fn(async (_object: unknown, permission: string) => (options.keyGrants ?? []).includes(permission));
    const insertLogin = vi.fn().mockResolvedValue(undefined);

    const registry = new Map<unknown, unknown>([
        [ActorsRepository, { existsActive }],
        [AuthenticationSessionService, { deleteSession }],
        [PermissionsService, { checkSubject }],
        [CacheProvider, { add: vi.fn().mockResolvedValue(options.firstInWindow ?? true) }],
        [LoginActivityRepository, { insertLogin }],
        [Logger, { warn: vi.fn() }],
        [DeadairPermissionsTupleRepository, { listRelationsForSubjectOnObject: vi.fn().mockResolvedValue(options.relations ?? []) }],
        // Clearing the dead cookie reads TRUST_PROXY to decide whether this request's scheme can
        // be taken off a forwarded header. A layer answers with strings; nothing here sets one.
        [AppConfig, { get: (_key: string, fallback: unknown) => fallback }],
    ]);

    const ctx = {
        method: options.method ?? 'POST',
        path: options.path ?? '/plugins/rescan',
        requestId: 'req-1',
        ipAddress: '203.0.113.1',
        secure: false,
        req: { headers: {} },
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

    return { ctx, next, existsActive, deleteSession, cookieSet, overrides, checkSubject, insertLogin };
};

/** The session ServerKit's `ApiKeyService.authenticate` mints: unpersisted, no `actorType`, one claim. */
const keySession = (ownerKind = 'user') => ({
    sessionToken: 'random-per-request',
    subject: ACTOR_ID,
    claims: { apiKey: { id: 'key-1', name: 'doorbell', owner: { kind: ownerKind, actorId: ACTOR_ID }, scopes: ['view'], metadata: {} } },
    factors: [{ method: 'apikey', kind: 'possession' }],
});

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

    describe('a request made with an API key', () => {
        it('acts as the key’s owner, with the owner’s roles and what the key was granted', async () => {
            const h = harness({ relations: ['admin'], keyGrants: ['view'] });
            h.ctx.authenticationSession = keySession();

            await authorizationContextMiddleware()(h.ctx, h.next);

            const actor = (h.overrides.get(AuthorizationContext) as AuthorizationContext).actor;
            expect(actor.kind).toBe('user');
            if (actor.kind !== 'user') return;
            expect(actor.actorId).toBe(ACTOR_ID);
            expect([...actor.platformRoles]).toEqual(['admin']);
            expect(actor.apiKey?.id).toBe('key-1');
            expect([...(actor.apiKey?.grants ?? [])]).toEqual(['view']);
            expect(h.checkSubject).toHaveBeenCalledWith({ namespace: 'apikey', id: 'key-1' }, 'manage', {
                kind: 'concrete',
                namespace: 'user',
                id: ACTOR_ID,
            });
        });

        it('checks the owner is alive even on a bootstrap route, and answers 401 without touching sessions or cookies', async () => {
            // The bootstrap exemption exists for a browser re-presenting a dead JWT to the route
            // that replaces it. A key has no such loop, and the session ServerKit minted for it
            // references nothing stored, so there is nothing to revoke and the cookie is not its own.
            const h = harness({ path: '/auth/token', actorExists: false });
            h.ctx.authenticationSession = keySession();

            const error = await authorizationContextMiddleware()(h.ctx, h.next).catch((e: unknown) => e);

            expect(IsHttpError(error) && error.statusCode).toBe(401);
            expect(IsHttpError(error) && (error.details as { code?: string }).code).toBe(ErrorCodes.SESSION_ACTOR_MISSING);
            expect(h.deleteSession).not.toHaveBeenCalled();
            expect(h.cookieSet).not.toHaveBeenCalled();
            expect(h.next).not.toHaveBeenCalled();
        });

        it('records the first use in a window as a login event carrying the caller’s address', async () => {
            const h = harness({ keyGrants: ['view'], firstInWindow: true });
            h.ctx.authenticationSession = keySession();

            await authorizationContextMiddleware()(h.ctx, h.next);

            expect(h.insertLogin).toHaveBeenCalledWith(
                expect.objectContaining({
                    actorId: ACTOR_ID,
                    factorType: 'apikey',
                    factorId: 'key-1',
                    ip: '203.0.113.1',
                    sessionToken: null,
                    mfaSatisfied: false,
                }),
            );
        });

        it('records nothing for a later use inside the same window', async () => {
            const h = harness({ keyGrants: ['view'], firstInWindow: false });
            h.ctx.authenticationSession = keySession();

            await authorizationContextMiddleware()(h.ctx, h.next);

            expect(h.insertLogin).not.toHaveBeenCalled();
            expect(h.next).toHaveBeenCalledOnce();
        });

        it('carries on when recording the use fails, because a good key must not fail on a log write', async () => {
            const h = harness({ keyGrants: ['view'] });
            h.insertLogin.mockRejectedValue(new Error('database blip'));
            h.ctx.authenticationSession = keySession();

            await authorizationContextMiddleware()(h.ctx, h.next);

            expect(h.next).toHaveBeenCalledOnce();
        });

        it('treats a key owned by anything but a user as the untrusted caller it is', async () => {
            const h = harness({ keyGrants: ['view', 'manage'] });
            h.ctx.authenticationSession = keySession('service');

            await authorizationContextMiddleware()(h.ctx, h.next);

            const actor = (h.overrides.get(AuthorizationContext) as AuthorizationContext).actor;
            expect(actor).toMatchObject({ kind: 'system', source: 'http' });
        });
    });

    // The request half of the trace root. The job half is in `job.trace.test.ts`; both exist so that
    // every log line and every span downstream can say which decision it belongs to, and the id is
    // the one already in the audit trail rather than a second one invented here.
    describe('the trace it opens', () => {
        it('runs the rest of the request inside a trace named by the request id', async () => {
            const h = harness({ method: 'GET', path: '/plugins' });
            let seen: ReturnType<typeof currentTrace>;
            h.next.mockImplementation(async () => {
                seen = currentTrace();
            });

            await authorizationContextMiddleware()(h.ctx, h.next);

            // The same `requestId` handed to the envelope, which is what makes a log line and an
            // `app.request_id` GUC name one decision instead of two.
            expect(seen).toEqual({ id: 'req-1', kind: 'GET /plugins' });
            expect((h.overrides.get(AuthorizationContext) as AuthorizationContext).request.requestId).toBe('req-1');
        });

        it('closes the trace before the response leaves, even when the route throws', async () => {
            // Koa reuses the thread for the next request. A trace that outlived a failed one would
            // file the following request's lines under it.
            const h = harness();
            h.next.mockRejectedValue(new Error('the route blew up'));

            await expect(authorizationContextMiddleware()(h.ctx, h.next)).rejects.toThrow('the route blew up');
            expect(currentTrace()).toBeUndefined();
        });

        it('opens no trace when the actor check rejects the request', async () => {
            // The 401 is thrown before `next`, so there is no decision to name: nothing downstream
            // runs. Asserted so that a future reordering that moved the trace above the check would
            // be a visible change rather than a silent one.
            const h = harness({ actorExists: false });

            await authorizationContextMiddleware()(h.ctx, h.next).catch(() => undefined);

            expect(h.next).not.toHaveBeenCalled();
            expect(currentTrace()).toBeUndefined();
        });
    });
});
