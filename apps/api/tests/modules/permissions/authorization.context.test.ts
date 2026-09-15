// The helpers every service narrows the actor through. An API key acts as its owner, so it is a
// user actor, and these are where it is kept away from credentials and from role checks it was not
// granted enough to pass.

import { describe, expect, it } from 'vitest';

import { AuthorizationContext, type UserActor } from '../../../src/modules/permissions/authorization.context.js';

const admin = (grants?: ReadonlyArray<'view' | 'manage'>): UserActor => ({
    kind: 'user',
    sessionToken: 's-1',
    actorId: 'u-1',
    factors: [],
    platformRoles: new Set(['admin']),
    ...(grants ? { apiKey: { id: 'k-1', name: 'doorbell', grants: new Set(grants) } } : {}),
});

describe('AuthorizationContext.requireAuthentication', () => {
    it('answers the signed-in person', () => {
        expect(new AuthorizationContext(admin()).requireAuthentication()).toEqual({ actorId: 'u-1', sessionToken: 's-1' });
    });

    it('refuses an API key, even one that may manage everything', () => {
        // The seam that keeps a key away from factors, sessions, step-up and other keys, and from
        // `POST /auth/factors/verify` in particular, which would mint it a month-long session.
        expect(() => new AuthorizationContext(admin(['view', 'manage'])).requireAuthentication()).toThrow(
            expect.objectContaining({ statusCode: 403 }),
        );
    });
});

describe('AuthorizationContext.requireUser', () => {
    it('still answers a key, which acts as its owner for everything but credentials', () => {
        expect(new AuthorizationContext(admin(['view'])).requireUser().actorId).toBe('u-1');
    });
});

describe('AuthorizationContext.hasPlatformRole', () => {
    it('answers the owner’s roles for a signed-in person', () => {
        expect(new AuthorizationContext(admin()).hasPlatformRole('admin')).toBe(true);
    });

    it('answers them for a manage key', () => {
        expect(new AuthorizationContext(admin(['view', 'manage'])).hasPlatformRole('admin')).toBe(true);
    });

    it('answers nothing for a view key, whatever its owner holds', () => {
        const context = new AuthorizationContext(admin(['view']));

        expect(context.hasPlatformRole('admin')).toBe(false);
        expect(() => context.requirePlatformRole('admin')).toThrow(expect.objectContaining({ statusCode: 403 }));
    });
});
