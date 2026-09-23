// The refresh grant is the only unauthenticated path that can resurrect a session, so it carries
// its own copy of the "is this subject still a real actor?" check that
// `authorization.context.middleware` applies to authenticated requests. Sessions live in Redis and
// actors live in Postgres; a database rebuild wipes the second and leaves the first, and without
// this check the grant mints a fresh access token for a deleted user.
//
// `handleRefreshToken` is private and the service takes sixteen collaborators, only four of which
// this path touches. Rather than stand the whole graph up, the instance is built off the prototype
// with those four assigned — the constructor only populates the grant-handler map, which these
// tests bypass by calling the handler directly.

import { describe, expect, it, vi } from 'vitest';
import { IsHttpError } from '@maroonedsoftware/errors';

import { AuthenticationService } from '../../../src/modules/authentication/authentication.service.js';

const ACTOR_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_TOKEN = 'session-token';

const TOKENS = {
    accessToken: 'access',
    refreshToken: 'refresh-next',
    expiresIn: 900,
    tokenType: 'Bearer',
    scope: '',
};

const build = (options: { actorExists?: boolean; refreshRejects?: boolean } = {}) => {
    // Stands in for `refreshSession` as @maroonedsoftware/authentication 6 runs it: the token is
    // verified and its `jti` claimed first, then the guard sees the loaded session, and only a guard
    // that returns lets tokens be minted. A token the grant itself refuses never reaches the guard.
    const refreshSession = vi.fn(
        async (_token: string, _audience: string | string[] | undefined, guard?: (session: unknown) => Promise<void> | void) => {
            if (options.refreshRejects) throw new Error('replayed');
            await guard?.({ sessionToken: SESSION_TOKEN, subject: ACTOR_ID });
            return TOKENS;
        },
    );
    const sessionService = {
        deleteSession: vi.fn().mockResolvedValue(undefined),
        refreshSession,
    };
    const actorsRepository = { existsActive: vi.fn().mockResolvedValue(options.actorExists ?? true) };
    const requestCookieJar = { getRefreshToken: vi.fn().mockReturnValue('refresh-presented') };
    const responseCookieJar = { clearRefreshToken: vi.fn() };

    const service = Object.create(AuthenticationService.prototype) as AuthenticationService;
    Object.assign(service, { sessionService, actorsRepository, requestCookieJar, responseCookieJar });

    const refresh = (body?: string) => (service as any).handleRefreshToken({ grant_type: 'refresh_token', refresh_token: body });

    return { refresh, sessionService, actorsRepository, requestCookieJar, responseCookieJar };
};

describe('AuthenticationService refresh grant', () => {
    it('refreshes normally when the session subject is still a live actor', async () => {
        const h = build();

        await expect(h.refresh()).resolves.toMatchObject({ result: 'token', accessToken: 'access' });
        expect(h.actorsRepository.existsActive).toHaveBeenCalledWith(ACTOR_ID);
        expect(h.sessionService.refreshSession).toHaveBeenCalledWith('refresh-presented', undefined, expect.any(Function));
    });

    it('refuses to mint a token for an actor that no longer exists', async () => {
        const h = build({ actorExists: false });

        const error = await h.refresh().catch((e: unknown) => e);

        expect(IsHttpError(error) && error.statusCode).toBe(401);
        expect(IsHttpError(error) && error.headers?.['WWW-Authenticate']).toContain('invalid_grant');
    });

    it('revokes the orphaned session and drops the cookie that presented it', async () => {
        const h = build({ actorExists: false });

        await h.refresh().catch(() => undefined);

        expect(h.sessionService.deleteSession).toHaveBeenCalledWith(SESSION_TOKEN, 'expiry');
        expect(h.responseCookieJar.clearRefreshToken).toHaveBeenCalledOnce();
    });

    it('keeps a body-presented token from an API client from touching the browser cookie', async () => {
        const h = build({ actorExists: false });

        await h.refresh('refresh-from-body').catch(() => undefined);

        expect(h.responseCookieJar.clearRefreshToken).not.toHaveBeenCalled();
    });

    it('leaves a token the refresh grant refuses to that grant, and never asks after the actor', async () => {
        // Replay detection and family revocation belong to refreshSession, and they run before the
        // guard: a token that grant refuses is not this check's verdict to render.
        const h = build({ refreshRejects: true });

        await expect(h.refresh()).rejects.toThrow('replayed');
        expect(h.actorsRepository.existsActive).not.toHaveBeenCalled();
        expect(h.sessionService.deleteSession).not.toHaveBeenCalled();
    });
});
