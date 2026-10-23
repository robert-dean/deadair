// The read side of the People section. Pinned here: only an admin may read it, a person's role is
// narrowed to the one they hold, absent values stay absent rather than arriving as null, a factor's
// secret never leaves, and an unknown id is a plain 404.

import { describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import { IsHttpError } from '@maroonedsoftware/errors';

import { UsersService } from '../../../src/modules/users/users.service.js';
import { AuthorizationContext, type UserActor } from '../../../src/modules/permissions/authorization.context.js';
import type { UsersRepository, UserRow } from '../../../src/modules/users/users.repository.js';
import type { ActorsRepository } from '../../../src/modules/authentication/repositories/actors.repository.js';
import { SessionActivityService } from '../../../src/modules/authentication/session.activity.service.js';
import type { PlatformRoleService } from '../../../src/modules/permissions/platform.role.service.js';
import type { StrongFactorGate } from '../../../src/modules/authentication/strong.factor.gate.js';
import type {
    AuthenticationSession,
    AuthenticationSessionService,
    AuthenticatorFactorService,
    FidoFactorService,
} from '@maroonedsoftware/authentication';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const FRIEND_ID = '22222222-2222-4222-8222-222222222222';
const CREATED = DateTime.fromISO('2026-10-01T12:00:00Z', { zone: 'utc' });

const actor = (roles: ReadonlyArray<'admin' | 'listener'>): UserActor => ({
    kind: 'user',
    sessionToken: 's',
    actorId: ADMIN_ID,
    factors: [],
    platformRoles: new Set(roles),
});

const friend: UserRow = { id: FRIEND_ID, active: true, createdAt: CREATED, email: 'friend@example.com', roles: ['listener'], hasStrongFactor: true };

function build(roles: ReadonlyArray<'admin' | 'listener'> = ['admin'], rows: UserRow[] = [friend], mailConfigured = true) {
    const users = {
        list: vi.fn(async () => ({ total: rows.length, data: rows })),
        get: vi.fn(async (id: string) => rows.find(row => row.id === id)),
    };
    const actors = {
        listFactors: vi.fn(async () => [
            { method: 'email', kind: 'possession', methodId: 'f-1', label: 'f***@example.com' },
            { method: 'authenticator', kind: 'possession', methodId: 'f-2', label: 'Phone', secret: 'never' },
        ]),
    };
    const sessions = {
        listSessionsForActor: vi.fn(async () => []),
        listLoginsForActor: vi.fn(async () => ({
            total: 1,
            data: [{ occurredAt: CREATED, factorType: 'password', mfaSatisfied: true, ip: null, userAgent: 'deadair-android' }],
        })),
    };
    const platformRoles = {
        assertMayReassign: vi.fn(async () => undefined),
        assertMayDeactivate: vi.fn(async () => undefined),
        assign: vi.fn(async () => undefined),
    };
    const strongFactorGate = { assertRecentIfAnyEnrolled: vi.fn(async () => undefined) };
    const sessionService = { revokeAllForSubject: vi.fn(async () => 1) };
    const authenticatorFactors = { listFactors: vi.fn(async () => [{ id: 'totp-1' }, { id: 'totp-2' }]), deleteFactor: vi.fn(async () => undefined) };
    const fidoFactors = { listFactors: vi.fn(async () => [{ id: 'key-1' }]), deleteFactor: vi.fn(async () => undefined) };
    Object.assign(actors, { update: vi.fn(async () => ({})) });
    const mail = { isConfigured: vi.fn(() => mailConfigured), send: vi.fn(async () => undefined) };
    const tasks: Array<() => Promise<void>> = [];
    const afterCommit = { add: vi.fn((task: () => Promise<void>) => void tasks.push(task)) };
    const logger = { warn: vi.fn() };
    const service = new UsersService(
        users as unknown as UsersRepository,
        actors as unknown as ActorsRepository,
        sessions as unknown as SessionActivityService,
        new AuthorizationContext(actor(roles)),
        platformRoles as unknown as PlatformRoleService,
        strongFactorGate as unknown as StrongFactorGate,
        sessionService as unknown as AuthenticationSessionService,
        authenticatorFactors as unknown as AuthenticatorFactorService,
        fidoFactors as unknown as FidoFactorService,
        mail as never,
        afterCommit as never,
        logger as never,
    );
    return {
        service,
        users,
        actors: actors as typeof actors & { update: ReturnType<typeof vi.fn> },
        sessions,
        platformRoles,
        strongFactorGate,
        sessionService,
        authenticatorFactors,
        fidoFactors,
        mail,
        tasks,
        logger,
    };
}

describe('UsersService.list', () => {
    it('refuses anybody who is not an admin', async () => {
        const { service, users } = build(['listener']);
        await expect(service.list({ page: 0, pageSize: 25, sort: 'desc' })).rejects.toSatisfy(IsHttpError);
        expect(users.list).not.toHaveBeenCalled();
    });

    it('turns the page into an offset and passes only the filters that were set', async () => {
        const { service, users } = build();

        await service.list({ page: 2, pageSize: 10, sort: 'asc', role: 'listener' });

        expect(users.list).toHaveBeenCalledWith({ limit: 10, offset: 20, sort: 'asc', role: 'listener' });
    });

    it('answers each person with their one role, and the page they asked for', async () => {
        const { service } = build(['admin'], [{ ...friend, roles: ['listener', 'admin'] }]);

        const page = await service.list({ page: 0, pageSize: 25, sort: 'desc' });

        expect(page.meta).toEqual({ page: 0, pageSize: 25, sort: 'desc', total: 1 });
        expect(page.data[0]).toMatchObject({ id: FRIEND_ID, role: 'admin', email: 'friend@example.com' });
    });

    it('leaves out what a person does not have rather than sending null', async () => {
        const { service } = build(['admin'], [{ id: FRIEND_ID, active: false, createdAt: CREATED, roles: [], hasStrongFactor: false }]);

        const [person] = (await service.list({ page: 0, pageSize: 25, sort: 'desc' })).data;

        expect(person).not.toHaveProperty('email');
        expect(person).not.toHaveProperty('role');
        expect(person).not.toHaveProperty('lastSignInAt');
    });
});

describe('UsersService.get', () => {
    it('answers 404 for an id that is not a person', async () => {
        const { service } = build();
        await expect(service.get('33333333-3333-4333-8333-333333333333')).rejects.toSatisfy(IsHttpError);
    });

    it('lists how they sign in without any secret, and their recent sign-ins', async () => {
        const { service, sessions } = build();

        const person = await service.get(FRIEND_ID);

        expect(person.factors).toEqual([
            { method: 'email', kind: 'possession', methodId: 'f-1', label: 'f***@example.com' },
            { method: 'authenticator', kind: 'possession', methodId: 'f-2', label: 'Phone' },
        ]);
        expect(person.signIns).toEqual([{ occurredAt: CREATED, method: 'password', mfaSatisfied: true, userAgent: 'deadair-android' }]);
        expect(sessions.listLoginsForActor).toHaveBeenCalledWith(FRIEND_ID, { limit: 20, offset: 0 });
    });

    // The strict `Session` contract refused a key the listing used to add (`organizationId`), so
    // every person with a live session answered 400 and the console's drawer never loaded anyone.
    it('answers the sessions the real listing produces, which the strict contract accepts', async () => {
        const { service, sessions } = build();
        const live = {
            sessionToken: 'tok-1',
            subject: FRIEND_ID,
            issuedAt: CREATED,
            expiresAt: CREATED.plus({ days: 30 }),
            lastAccessedAt: CREATED,
            factors: [{ method: 'password', methodId: 'p-1', kind: 'knowledge', issuedAt: CREATED, authenticatedAt: CREATED }],
            claims: { loginIp: '10.0.0.2', loginUserAgent: 'deadair-web' },
        } as unknown as AuthenticationSession;
        const activity = new SessionActivityService(
            {} as never,
            { getSessionsForSubject: vi.fn(async () => [live]) } as unknown as AuthenticationSessionService,
            new AuthorizationContext(actor(['admin'])),
            { warn: vi.fn() } as never,
        );
        sessions.listSessionsForActor.mockImplementation(() => activity.listSessionsForActor(FRIEND_ID) as never);

        const person = await service.get(FRIEND_ID);

        expect(person.sessions).toHaveLength(1);
        expect(person.sessions[0]).toMatchObject({
            sessionToken: 'tok-1',
            actorId: FRIEND_ID,
            ip: '10.0.0.2',
            userAgent: 'deadair-web',
            isCurrent: false,
        });
    });
});

describe('UsersService writes', () => {
    it('refuse anybody who is not an admin, before asking for a step-up', async () => {
        const h = build(['listener']);
        await expect(h.service.changeRole(FRIEND_ID, { role: 'admin' })).rejects.toSatisfy(IsHttpError);
        expect(h.strongFactorGate.assertRecentIfAnyEnrolled).not.toHaveBeenCalled();
    });

    it('each ask the caller for a recent strong factor', async () => {
        const h = build();
        await h.service.signOut(FRIEND_ID);
        expect(h.strongFactorGate.assertRecentIfAnyEnrolled).toHaveBeenCalledWith(ADMIN_ID);
    });

    it('answer 404 for an id that is not a person, and change nothing', async () => {
        const h = build();
        await expect(h.service.deactivate('33333333-3333-4333-8333-333333333333')).rejects.toSatisfy(IsHttpError);
        expect(h.actors.update).not.toHaveBeenCalled();
    });

    it('change a role only after the guards agree, attributed to the admin acting', async () => {
        const h = build();

        await h.service.changeRole(FRIEND_ID, { role: 'admin' });

        expect(h.platformRoles.assertMayReassign).toHaveBeenCalledWith(ADMIN_ID, FRIEND_ID, 'admin');
        expect(h.platformRoles.assign).toHaveBeenCalledWith(FRIEND_ID, 'admin', ADMIN_ID);
    });

    it('do not change a role the guards refuse', async () => {
        const h = build();
        h.platformRoles.assertMayReassign.mockRejectedValue(new Error('refused'));

        await expect(h.service.changeRole(FRIEND_ID, { role: 'listener' })).rejects.toThrow('refused');
        expect(h.platformRoles.assign).not.toHaveBeenCalled();
    });

    it('switch a person off by flag, end their sessions, and delete nothing', async () => {
        const h = build();

        await h.service.deactivate(FRIEND_ID);

        expect(h.platformRoles.assertMayDeactivate).toHaveBeenCalledWith(ADMIN_ID, FRIEND_ID);
        expect(h.actors.update).toHaveBeenCalledWith(FRIEND_ID, false);
        expect(h.sessionService.revokeAllForSubject).toHaveBeenCalledWith(FRIEND_ID, 'logout');
        expect(h.authenticatorFactors.deleteFactor).not.toHaveBeenCalled();
    });

    it('switch a person back on', async () => {
        const h = build();
        await h.service.reactivate(FRIEND_ID);
        expect(h.actors.update).toHaveBeenCalledWith(FRIEND_ID, true);
    });

    it('reset MFA by removing every authenticator and passkey, then signing the person out', async () => {
        const h = build();

        await h.service.resetMfa(FRIEND_ID);

        expect(h.authenticatorFactors.deleteFactor.mock.calls).toEqual([
            [FRIEND_ID, 'totp-1'],
            [FRIEND_ID, 'totp-2'],
        ]);
        expect(h.fidoFactors.deleteFactor).toHaveBeenCalledWith(FRIEND_ID, 'key-1');
        expect(h.sessionService.revokeAllForSubject).toHaveBeenCalledWith(FRIEND_ID, 'logout');
    });

    it('tell the person their second step was reset, once the reset has committed', async () => {
        const h = build();

        await h.service.resetMfa(FRIEND_ID);
        expect(h.mail.send).not.toHaveBeenCalled();
        for (const task of h.tasks) await task();

        expect(h.mail.send).toHaveBeenCalledWith({ to: 'friend@example.com', template: 'SecondFactorReset', data: {} });
    });

    it('still reset a second step when the notice cannot be sent', async () => {
        const h = build();
        h.mail.send.mockRejectedValue(new Error('refused'));

        await h.service.resetMfa(FRIEND_ID);
        for (const task of h.tasks) await expect(task()).resolves.toBeUndefined();

        expect(h.logger.warn).toHaveBeenCalled();
    });

    it('send no notice on a station with no mail server', async () => {
        const h = build(['admin'], [friend], false);
        await h.service.resetMfa(FRIEND_ID);
        expect(h.tasks).toHaveLength(0);
    });

    it('offer no way for an admin to change an address', () => {
        // Only the person changes their own address, through the verified email-factor enrolment on
        // their own Sign-in and security page. Nothing on this service takes one.
        const methods = Object.getOwnPropertyNames(UsersService.prototype);
        expect(methods.filter(name => /email|address/i.test(name))).toEqual([]);
    });
});
