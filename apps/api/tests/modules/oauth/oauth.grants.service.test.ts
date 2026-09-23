// A person's connected apps. Disconnecting one ends its sessions at once; somebody else's
// connection answers 404; and an app the station can no longer find still lists, without a name.

import { describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import { IsHttpError } from '@maroonedsoftware/errors';

import { OAuthGrantsService } from '../../../src/modules/oauth/oauth.grants.service.js';

const ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const GRANT = { id: 'g1', clientId: 'dyn_1', subject: ACTOR, resource: 'https://r/api/mcp', scope: ['mcp'], createdAt: DateTime.utc() };

function build(options: { mine?: boolean; clientKnown?: boolean } = {}) {
    const grants = {
        listForActor: vi.fn(async () => [GRANT]),
        revoke: vi.fn(async () => ((options.mine ?? true) ? GRANT : undefined)),
    };
    const clients = {
        resolve: vi.fn(async () => {
            if (options.clientKnown === false) throw new Error('invalid_client');
            return { clientId: 'dyn_1', clientName: 'Claude' };
        }),
    };
    const sessions = {
        getSessionsForSubject: vi.fn(async () => [
            { sessionToken: 'app', claims: { oauth: { clientId: 'dyn_1', resource: 'r', scope: [], grantId: 'g1' } } },
        ]),
        deleteSession: vi.fn(async () => undefined),
    };
    const service = new OAuthGrantsService(
        { requireAuthentication: () => ({ actorId: ACTOR }) } as never,
        grants as never,
        clients as never,
        sessions as never,
    );
    return { service, grants, sessions };
}

describe('OAuthGrantsService', () => {
    it("lists the person's connections by the app's name", async () => {
        const { grants } = await build().service.list();
        expect(grants).toEqual([expect.objectContaining({ id: 'g1', clientName: 'Claude', resource: 'https://r/api/mcp' })]);
    });

    it('lists a connection whose app has gone, without a name', async () => {
        const { grants } = await build({ clientKnown: false }).service.list();
        expect(grants[0]).not.toHaveProperty('clientName');
    });

    it('disconnecting ends the sessions held through it', async () => {
        const h = build();
        await h.service.revoke('g1');
        expect(h.grants.revoke).toHaveBeenCalledWith('g1', ACTOR);
        expect(h.sessions.deleteSession).toHaveBeenCalledWith('app', 'logout');
    });

    it("answers 404 for somebody else's connection", async () => {
        const h = build({ mine: false });
        const error = await h.service.revoke('g1').catch((e: unknown) => e);
        expect(IsHttpError(error) && error.statusCode).toBe(404);
        expect(h.sessions.deleteSession).not.toHaveBeenCalled();
    });
});
