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
import type { SessionActivityService } from '../../../src/modules/authentication/session.activity.service.js';

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

function build(roles: ReadonlyArray<'admin' | 'listener'> = ['admin'], rows: UserRow[] = [friend]) {
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
    const service = new UsersService(
        users as unknown as UsersRepository,
        actors as unknown as ActorsRepository,
        sessions as unknown as SessionActivityService,
        new AuthorizationContext(actor(roles)),
    );
    return { service, users, actors, sessions };
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
});
