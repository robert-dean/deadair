// The one read that tells a client which platform roles it holds. Everything it answers is
// already on the actor the authorization middleware built, so what is pinned here is the shape a
// phone reads — sorted roles, the actor id, and a refusal for anything that is not a person —
// rather than any resolution of roles, which is the middleware's and is tested there.

import { describe, expect, it } from 'vitest';
import { IsHttpError } from '@maroonedsoftware/errors';

import { SessionsService } from '../../../src/modules/authentication/sessions.service.js';
import { AuthorizationContext } from '../../../src/modules/permissions/authorization.context.js';
import type { SystemActor, UserActor } from '../../../src/modules/permissions/authorization.context.js';
import type { SessionActivityService } from '../../../src/modules/authentication/session.activity.service.js';
import type { ResponseCookieJar } from '../../../src/modules/authentication/response.cookie.jar.js';

const userActor = (actorId: string, roles: ReadonlyArray<'admin' | 'listener'> = []): UserActor => ({
    kind: 'user',
    sessionToken: 'test-session',
    actorId,
    factors: [],
    platformRoles: new Set(roles),
});

const systemActor: SystemActor = { kind: 'system', sessionToken: '', source: 'test' };

/** Neither collaborator is reached by the read under test; they exist so the constructor is honest. */
const serviceFor = (actor: UserActor | SystemActor) =>
    new SessionsService({} as SessionActivityService, new AuthorizationContext(actor), {} as ResponseCookieJar);

describe('SessionsService.readCurrentSession', () => {
    it('names the operator as an admin', async () => {
        await expect(serviceFor(userActor('u-1', ['admin'])).readCurrentSession()).resolves.toEqual({ actorId: 'u-1', roles: ['admin'] });
    });

    it('names a listener as one', async () => {
        await expect(serviceFor(userActor('u-2', ['listener'])).readCurrentSession()).resolves.toEqual({ actorId: 'u-2', roles: ['listener'] });
    });

    it('answers the roles sorted, whatever order the store handed them over in', async () => {
        const { roles } = await serviceFor(userActor('u-3', ['listener', 'admin'])).readCurrentSession();

        expect(roles).toEqual(['admin', 'listener']);
    });

    it('answers no roles for an account nobody has granted one', async () => {
        // Which today is any account that did not come in through onboarding. The route's
        // `platform.view` gate refuses such a session before this runs; the service still has to
        // be honest about the shape if it is ever reached another way.
        await expect(serviceFor(userActor('u-4')).readCurrentSession()).resolves.toEqual({ actorId: 'u-4', roles: [] });
    });

    it('refuses anything that is not a person', async () => {
        await expect(serviceFor(systemActor).readCurrentSession()).rejects.toSatisfy(IsHttpError);
    });
});
