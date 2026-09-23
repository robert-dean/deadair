// Apps an operator registers by hand, and withdrawing any app. What matters: a secret exists only
// for an app that keeps one and is returned once, an address that could leak a code is refused, and
// withdrawing an app ends every approval of it and every session it holds.

import { describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import { IsHttpError } from '@maroonedsoftware/errors';
import { hashOAuthClientSecret } from '@maroonedsoftware/authentication';

import { OAuthClientsService } from '../../../src/modules/oauth/oauth.clients.service.js';

const ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function build(options: { revoked?: boolean } = {}) {
    const clients = {
        createPreregistered: vi.fn(async (client: Record<string, unknown>) => ({ ...client, createdAt: DateTime.utc() })),
        revoke: vi.fn(async () => options.revoked ?? true),
        listAll: vi.fn(async () => []),
    };
    const grants = { revokeForClient: vi.fn(async () => [{ id: 'g1', subject: ACTOR }]) };
    const sessions = {
        getSessionsForSubject: vi.fn(async () => [
            { sessionToken: 'app', claims: { oauth: { clientId: 'pre_1', resource: 'r', scope: [], grantId: 'g1' } } },
            { sessionToken: 'console', claims: {} },
        ]),
        deleteSession: vi.fn(async () => undefined),
    };
    const service = new OAuthClientsService(
        { requireAuthentication: () => ({ actorId: ACTOR }) } as never,
        clients as never,
        grants as never,
        sessions as never,
        { assertRecentIfAnyEnrolled: vi.fn(async () => undefined) } as never,
    );
    return { service, clients, sessions };
}

describe('OAuthClientsService', () => {
    it('gives an app that keeps a secret one, returned once and stored only as a hash', async () => {
        const h = build();
        const issued = await h.service.create({
            name: ' Home Assistant ',
            redirectUris: ['https://ha.example/cb'],
            tokenEndpointAuthMethod: 'client_secret_post',
        });

        const stored = h.clients.createPreregistered.mock.calls[0]![0] as { secretHash: string; clientName: string; clientId: string };
        expect(issued.clientSecret).toBeTruthy();
        expect(stored.secretHash).toBe(hashOAuthClientSecret(issued.clientSecret!));
        expect(stored.clientName).toBe('Home Assistant');
        expect(stored.clientId).toMatch(/^pre_/);
        expect(h.clients.createPreregistered).toHaveBeenCalledWith(expect.anything(), ACTOR);
    });

    it('gives a public app no secret', async () => {
        const h = build();
        const issued = await h.service.create({ name: 'CLI', redirectUris: ['http://127.0.0.1/callback'], tokenEndpointAuthMethod: 'none' });
        expect(issued).not.toHaveProperty('clientSecret');
    });

    it('refuses an address a code could leak through', async () => {
        const h = build();
        const error = await h.service
            .create({ name: 'x', redirectUris: ['http://evil.example/cb'], tokenEndpointAuthMethod: 'none' })
            .catch((e: unknown) => e);
        expect(IsHttpError(error) && error.statusCode).toBe(400);
        expect(h.clients.createPreregistered).not.toHaveBeenCalled();
    });

    it('withdrawing an app ends the sessions it holds, and only those', async () => {
        const h = build();
        await h.service.revoke('pre_1');
        expect(h.sessions.deleteSession).toHaveBeenCalledTimes(1);
        expect(h.sessions.deleteSession).toHaveBeenCalledWith('app', 'logout');
    });

    it('answers 404 for an app that is not there', async () => {
        const h = build({ revoked: false });
        const error = await h.service.revoke('nope').catch((e: unknown) => e);
        expect(IsHttpError(error) && error.statusCode).toBe(404);
    });
});
