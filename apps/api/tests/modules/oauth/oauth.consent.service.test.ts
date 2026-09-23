// The consent page's API. The properties that matter: an API key can never approve an app, what is
// approved is the stash `describe` validated, approving needs the same recent second factor as
// issuing an API key, and the grant carries the claim that makes its session a user's.

import { describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import { httpError, IsHttpError } from '@maroonedsoftware/errors';
import type { AppConfig } from '@maroonedsoftware/appconfig';

import { OAuthConsentService, parseQuery } from '../../../src/modules/oauth/oauth.consent.service.js';
import { settingsConfig } from '../../utils/settings.config.js';

const ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FACTOR = { method: 'password', methodId: 'p', kind: 'knowledge', issuedAt: DateTime.utc(), authenticatedAt: DateTime.utc() };

function build(options: { enabled?: string; apiKey?: boolean; stepUpDenied?: boolean } = {}) {
    const server = {
        describeAuthorizationRequest: vi.fn(async () => ({ kind: 'redirect', redirectUrl: 'https://claude.ai/cb?error=x' })),
        approve: vi.fn(async () => ({ redirectUrl: 'https://claude.ai/cb?code=c' })),
        deny: vi.fn(async () => ({ redirectUrl: 'https://claude.ai/cb?error=access_denied' })),
    };
    const gate = {
        assertRecentIfAnyEnrolled: vi.fn(async () => {
            if (options.stepUpDenied) throw httpError(403).withDetails({ kind: 'step_up_required' });
        }),
    };
    const authz = {
        requireAuthentication: () => {
            if (options.apiKey) throw httpError(403).withDetails({ message: 'human authentication required' });
            return { actorId: ACTOR, sessionToken: 's' };
        },
        actor: { kind: 'user', actorId: ACTOR, factors: [FACTOR] },
    };
    const config: AppConfig = settingsConfig({ 'oauth.enabled': options.enabled ?? 'true' }).config;
    const service = new OAuthConsentService(
        authz as never,
        config,
        server as never,
        gate as never,
        { buildLoginContextClaims: () => ({ loginIp: '10.0.0.2' }) } as never,
    );
    return { service, server, gate };
}

const statusOf = async (promise: Promise<unknown>) => {
    const error = await promise.catch((e: unknown) => e);
    return IsHttpError(error) ? error.statusCode : undefined;
};

describe('OAuthConsentService', () => {
    it('hands the library the query as the app sent it, stashed for this person', async () => {
        const h = build();
        await h.service.describe({ query: '?client_id=abc&scope=mcp&resource=https%3A%2F%2Fr%2Fapi%2Fmcp' });
        expect(h.server.describeAuthorizationRequest).toHaveBeenCalledWith({ client_id: 'abc', scope: 'mcp', resource: 'https://r/api/mcp' }, ACTOR);
    });

    it('approves as this person, with the claim that makes the session a user and the factors it holds', async () => {
        const h = build();
        await expect(h.service.approve({ requestId: 'req-1' })).resolves.toEqual({ redirectUrl: 'https://claude.ai/cb?code=c' });
        expect(h.gate.assertRecentIfAnyEnrolled).toHaveBeenCalledWith(ACTOR);
        expect(h.server.approve).toHaveBeenCalledWith('req-1', {
            subject: ACTOR,
            claims: { actorType: 'user', loginIp: '10.0.0.2' },
            factors: [FACTOR],
        });
    });

    it('does not approve without a recent second factor where one is enrolled', async () => {
        const h = build({ stepUpDenied: true });
        expect(await statusOf(h.service.approve({ requestId: 'req-1' }))).toBe(403);
        expect(h.server.approve).not.toHaveBeenCalled();
    });

    it('denies without asking for a second factor', async () => {
        const h = build({ stepUpDenied: true });
        await h.service.deny({ requestId: 'req-1' });
        expect(h.server.deny).toHaveBeenCalledWith('req-1', ACTOR);
    });

    it('never lets an API key approve an app', async () => {
        const h = build({ apiKey: true });
        expect(await statusOf(h.service.approve({ requestId: 'req-1' }))).toBe(403);
        expect(h.server.approve).not.toHaveBeenCalled();
    });

    it('answers 404 while OAuth is off', async () => {
        const h = build({ enabled: 'false' });
        expect(await statusOf(h.service.describe({ query: 'client_id=abc' }))).toBe(404);
    });
});

describe('parseQuery', () => {
    it('keeps a repeated parameter as a list, for the library to refuse', () => {
        expect(parseQuery('redirect_uri=a&redirect_uri=b&x=1')).toEqual({ redirect_uri: ['a', 'b'], x: '1' });
    });
});
