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

const build = (options: { actorExists?: boolean; lookupFails?: boolean } = {}) => {
    const lookupSessionFromJwt = options.lookupFails
        ? vi.fn().mockRejectedValue(new Error('unverifiable'))
        : vi.fn().mockResolvedValue({ session: { sessionToken: SESSION_TOKEN, subject: ACTOR_ID }, jwtPayload: {} });
    const sessionService = {
        lookupSessionFromJwt,
        deleteSession: vi.fn().mockResolvedValue(undefined),
        refreshSession: vi.fn().mockResolvedValue(TOKENS),
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
        expect(h.sessionService.refreshSession).toHaveBeenCalledWith('refresh-presented');
    });

    it('refuses to mint a token for an actor that no longer exists', async () => {
        const h = build({ actorExists: false });

        const error = await h.refresh().catch((e: unknown) => e);

        expect(IsHttpError(error) && error.statusCode).toBe(401);
        expect(h.sessionService.refreshSession).not.toHaveBeenCalled();
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

    it('defers to the refresh grant when the token cannot be looked up at all', async () => {
        // Replay detection and family revocation belong to refreshSession; a token this check
        // cannot read is not this check's verdict to render.
        const h = build({ lookupFails: true });

        await expect(h.refresh()).resolves.toMatchObject({ result: 'token' });
        expect(h.sessionService.refreshSession).toHaveBeenCalledOnce();
        expect(h.actorsRepository.existsActive).not.toHaveBeenCalled();
    });
});
