// The one writer of a person's platform role. Pinned here: a person holds exactly one role after
// `assign`, `roleOf` answers the highest when an older account holds two, and the two guards the
// console relies on (nobody moves themselves, the last admin stays) are refused by the API itself.

import { describe, expect, it } from 'vitest';
import type { ObjectRef, RelationTuple, SubjectRef } from '@maroonedsoftware/permissions';
import { ErrorCodes } from '@deadair/error-codes';

import { PlatformRoleService, platformRoleTuple } from '../../../src/modules/permissions/platform.role.service.js';
import type { DeadairPermissionsTupleRepository } from '../../../src/modules/permissions/permissions.repository.js';

/** A tuple store that holds platform role tuples in memory, keyed `role:actorId`. */
const fakeStore = (initial: Array<[string, string]> = []) => {
    const held = new Map<string, { role: string; actorId: string; createdBy?: string }>();
    for (const [actorId, role] of initial) held.set(`${role}:${actorId}`, { role, actorId });
    const key = (t: RelationTuple) => `${t.relation}:${t.subject.kind === 'concrete' ? t.subject.id : '*'}`;
    const repo = {
        listRelationsForSubjectOnObject: async (_object: ObjectRef, subject: SubjectRef) =>
            [...held.values()].filter(h => subject.kind === 'concrete' && h.actorId === subject.id).map(h => h.role),
        write: async (tuples: RelationTuple[], createdBy?: string) => {
            for (const t of tuples) held.set(key(t), { role: t.relation, actorId: (t.subject as { id: string }).id, createdBy });
        },
        delete: async (tuples: RelationTuple[]) => {
            for (const t of tuples) held.delete(key(t));
        },
        countPlatformRoleHolders: async (role: string) => [...held.values()].filter(h => h.role === role).length,
    };
    return { held, service: new PlatformRoleService(repo as unknown as DeadairPermissionsTupleRepository) };
};

const refusalCode = async (promise: Promise<unknown>) => {
    try {
        await promise;
    } catch (error) {
        return (error as { details?: { code?: string } }).details?.code;
    }
    return undefined;
};

describe('platformRoleTuple', () => {
    it('is a concrete user on platform:main', () => {
        expect(platformRoleTuple('u-1', 'listener')).toEqual({
            object: { namespace: 'platform', id: 'main' },
            relation: 'listener',
            subject: { kind: 'concrete', namespace: 'user', id: 'u-1' },
        });
    });
});

describe('PlatformRoleService.roleOf', () => {
    it('answers the role a person holds', async () => {
        const { service } = fakeStore([['u-1', 'listener']]);
        await expect(service.roleOf('u-1')).resolves.toBe('listener');
    });

    it('answers nothing for an account nobody granted a role', async () => {
        const { service } = fakeStore();
        await expect(service.roleOf('u-1')).resolves.toBeUndefined();
    });

    it('answers the highest role for an account that predates the one-role rule', async () => {
        const { service } = fakeStore([
            ['u-1', 'listener'],
            ['u-1', 'admin'],
        ]);
        await expect(service.roleOf('u-1')).resolves.toBe('admin');
    });
});

describe('PlatformRoleService.assign', () => {
    it('replaces whatever role the person held, so they hold exactly one', async () => {
        const { service, held } = fakeStore([['u-1', 'admin']]);

        await service.assign('u-1', 'listener', 'u-boss');

        expect([...held.values()]).toEqual([{ role: 'listener', actorId: 'u-1', createdBy: 'u-boss' }]);
    });

    it('leaves other people alone', async () => {
        const { service, held } = fakeStore([['u-2', 'admin']]);

        await service.assign('u-1', 'listener', 'u-1');

        expect(held.has('admin:u-2')).toBe(true);
    });
});

describe('PlatformRoleService guards', () => {
    it('refuses to change your own role', async () => {
        const { service } = fakeStore([
            ['u-1', 'admin'],
            ['u-2', 'admin'],
        ]);
        expect(await refusalCode(service.assertMayReassign('u-1', 'u-1', 'listener'))).toBe(ErrorCodes.OWN_ACCOUNT_REFUSED);
    });

    it('refuses to move the last admin off the role', async () => {
        const { service } = fakeStore([
            ['u-1', 'admin'],
            ['u-2', 'listener'],
        ]);
        expect(await refusalCode(service.assertMayReassign('u-2', 'u-1', 'listener'))).toBe(ErrorCodes.LAST_ADMIN);
    });

    it('lets one admin move another while a second remains', async () => {
        const { service } = fakeStore([
            ['u-1', 'admin'],
            ['u-2', 'admin'],
        ]);
        await expect(service.assertMayReassign('u-1', 'u-2', 'listener')).resolves.toBeUndefined();
    });

    it('lets anybody be made an admin', async () => {
        const { service } = fakeStore([
            ['u-1', 'admin'],
            ['u-2', 'listener'],
        ]);
        await expect(service.assertMayReassign('u-1', 'u-2', 'admin')).resolves.toBeUndefined();
    });

    it('refuses to switch off yourself or the last admin, and allows a listener', async () => {
        const { service } = fakeStore([
            ['u-1', 'admin'],
            ['u-2', 'listener'],
        ]);
        expect(await refusalCode(service.assertMayDeactivate('u-1', 'u-1'))).toBe(ErrorCodes.OWN_ACCOUNT_REFUSED);
        expect(await refusalCode(service.assertMayDeactivate('u-2', 'u-1'))).toBe(ErrorCodes.LAST_ADMIN);
        await expect(service.assertMayDeactivate('u-1', 'u-2')).resolves.toBeUndefined();
    });
});
