import { describe, expect, it, vi } from 'vitest';
import { IsHttpError } from '@maroonedsoftware/errors';

import { AccessControlService } from '../../../src/modules/permissions/access.control.service.js';
import { AuthorizationContext } from '../../../src/modules/permissions/authorization.context.js';
import type { Actor, SystemActor, UserActor, VendorActor } from '../../../src/modules/permissions/authorization.context.js';
import type { PermissionsService } from '../../../src/modules/permissions/permissions.service.js';
import type { ObjectRef } from '@maroonedsoftware/permissions';

const userActor = (actorId: string | undefined, roles: ReadonlyArray<'admin' | 'listener'> = []): UserActor => ({
    kind: 'user',
    sessionToken: 'test-session',
    actorId: actorId as string,
    factors: [],
    platformRoles: new Set(roles),
});

const systemActor = (source: SystemActor['source']): SystemActor => ({ kind: 'system', sessionToken: '', source });

const vendorActor: VendorActor = { kind: 'vendor', sessionToken: '', vendor: 'stripe', eventId: 'evt_1' };

/**
 * A tiny fixture-backed fake of the two `PermissionsService` methods
 * `AccessControlService` actually calls. Encodes only the already-resolved
 * answer for each (object, permission, subject) triple a test needs; it does
 * not re-implement the Zanzibar relation walk.
 */
class FakePermissionsFixture {
    /** `<namespace>:<id>:<permission>:<userId>` → allowed. */
    private readonly grants = new Set<string>();
    /** `<namespace>:<permission>:<userId>` → visible ids. */
    private readonly visibility = new Map<string, string[]>();

    grant(namespace: string, id: string, permission: string, userId: string): this {
        this.grants.add(`${namespace}:${id}:${permission}:${userId}`);
        return this;
    }

    setVisible(namespace: string, permission: string, userId: string, ids: string[]): this {
        this.visibility.set(`${namespace}:${permission}:${userId}`, ids);
        return this;
    }

    asPermissionsService(): PermissionsService {
        return {
            checkSubject: vi.fn(async (object: { namespace: string; id: string }, permission: string, subject: { id: string }) =>
                this.grants.has(`${object.namespace}:${object.id}:${permission}:${subject.id}`),
            ),
            listObjects: vi.fn(async (namespace: string, permission: string, subject: { id: string }) => ({
                ids: this.visibility.get(`${namespace}:${permission}:${subject.id}`) ?? [],
                truncated: false,
            })),
        } as unknown as PermissionsService;
    }
}

interface Harness {
    service: AccessControlService;
    permissions: PermissionsService;
}

function build(actor: Actor, fixture: FakePermissionsFixture = new FakePermissionsFixture()): Harness {
    const permissions = fixture.asPermissionsService();
    return { service: new AccessControlService(new AuthorizationContext(actor), permissions), permissions };
}

async function expectForbidden(promise: Promise<unknown>): Promise<void> {
    await expect(promise).rejects.toSatisfy(error => IsHttpError(error) && error.statusCode === 403);
}

const OBJECT: ObjectRef = { namespace: 'plugin', id: 'deadair.spotify' };
const PLUGIN_PERMISSIONS = ['view', 'configure', 'enable', 'oauth'];

// A `system` actor sourced from `http` is not a trusted subsystem caller. Per
// authorization.context.middleware.ts, the middleware falls back to this shape
// in two situations: an unauthenticated request, and an authenticated session
// whose `claims.actorType` is not `'user'`. The second is the one that could
// otherwise reach a plugin mutation with no object grant, which is why the
// `http` source must be denied rather than trusted like the other four.
const TRUSTED_SOURCES: ReadonlyArray<SystemActor['source']> = ['pg-boss', 'cli', 'startup', 'test'];

describe.each(TRUSTED_SOURCES)('AccessControlService: trusted system actor (source=%s)', source => {
    it('require resolves', async () => {
        await expect(build(systemActor(source)).service.require(OBJECT, 'view')).resolves.toBeUndefined();
    });

    it('canAccess is true', async () => {
        await expect(build(systemActor(source)).service.canAccess(OBJECT, 'view')).resolves.toBe(true);
    });

    it('listVisibleIds returns { all: true }', async () => {
        await expect(build(systemActor(source)).service.listVisibleIds('plugin', 'view')).resolves.toEqual({ all: true });
    });

    it('permissionsForResource returns every candidate for the namespace', async () => {
        const result = await build(systemActor(source)).service.permissionsForResource(OBJECT);
        expect(result.sort()).toEqual([...PLUGIN_PERMISSIONS].sort());
    });
});

describe('AccessControlService: untrusted system actor (source=http)', () => {
    it('require throws 403', async () => {
        await expectForbidden(build(systemActor('http')).service.require(OBJECT, 'view'));
    });

    it('canAccess is false', async () => {
        await expect(build(systemActor('http')).service.canAccess(OBJECT, 'view')).resolves.toBe(false);
    });

    it('listVisibleIds returns an empty, non-truncated result', async () => {
        await expect(build(systemActor('http')).service.listVisibleIds('plugin', 'view')).resolves.toEqual({ ids: [], truncated: false });
    });

    it('permissionsForResource returns nothing', async () => {
        await expect(build(systemActor('http')).service.permissionsForResource(OBJECT)).resolves.toEqual([]);
    });
});

describe('AccessControlService: vendor actor', () => {
    it('require resolves without consulting PermissionsService', async () => {
        const { service, permissions } = build(vendorActor);
        await expect(service.require(OBJECT, 'view')).resolves.toBeUndefined();
        expect(permissions.checkSubject).not.toHaveBeenCalled();
    });

    it('canAccess is true', async () => {
        await expect(build(vendorActor).service.canAccess(OBJECT, 'view')).resolves.toBe(true);
    });

    it('listVisibleIds returns { all: true }', async () => {
        await expect(build(vendorActor).service.listVisibleIds('plugin', 'view')).resolves.toEqual({ all: true });
    });

    it('permissionsForResource returns every candidate for the namespace', async () => {
        const result = await build(vendorActor).service.permissionsForResource(OBJECT);
        expect(result.sort()).toEqual([...PLUGIN_PERMISSIONS].sort());
    });
});

describe('AccessControlService: admin user, no tuples', () => {
    it('require resolves via the admin platform role', async () => {
        await expect(build(userActor('u-admin', ['admin'])).service.require(OBJECT, 'view')).resolves.toBeUndefined();
    });

    it('canAccess is true', async () => {
        await expect(build(userActor('u-admin', ['admin'])).service.canAccess(OBJECT, 'view')).resolves.toBe(true);
    });

    it('listVisibleIds returns { all: true }', async () => {
        await expect(build(userActor('u-admin', ['admin'])).service.listVisibleIds('plugin', 'view')).resolves.toEqual({ all: true });
    });

    // Directly asserts admin coverage over every permission the `plugin`
    // namespace declares, not just `view`.
    it.each(PLUGIN_PERMISSIONS)('permissionsForResource includes plugin:%s', async permission => {
        const result = await build(userActor('u-admin', ['admin'])).service.permissionsForResource(OBJECT);
        expect(result).toContain(permission);
    });

    it('permissionsForResource returns exactly the four declared plugin permissions', async () => {
        const result = await build(userActor('u-admin', ['admin'])).service.permissionsForResource(OBJECT);
        expect(result.sort()).toEqual([...PLUGIN_PERMISSIONS].sort());
    });
});

describe('AccessControlService: listener user, no tuples, plugin namespace', () => {
    it('require throws 403 (listener only holds platform:view, not plugin:*)', async () => {
        await expectForbidden(build(userActor('u-listener', ['listener'])).service.require(OBJECT, 'view'));
    });

    it('canAccess is false', async () => {
        await expect(build(userActor('u-listener', ['listener'])).service.canAccess(OBJECT, 'view')).resolves.toBe(false);
    });

    it('listVisibleIds falls through to the tuple walk, which is empty for this fixture', async () => {
        await expect(build(userActor('u-listener', ['listener'])).service.listVisibleIds('plugin', 'view')).resolves.toEqual({
            ids: [],
            truncated: false,
        });
    });

    it('permissionsForResource returns nothing', async () => {
        await expect(build(userActor('u-listener', ['listener'])).service.permissionsForResource(OBJECT)).resolves.toEqual([]);
    });
});

describe('AccessControlService: roleless user, tuple grants the permission', () => {
    // Encodes the resolved result of a `plugin:deadair.spotify#operator@user:u-operator`
    // tuple: `view` follows `operator` in the relation graph.
    function fixtureFor(userId: string): FakePermissionsFixture {
        return new FakePermissionsFixture().grant('plugin', OBJECT.id, 'view', userId).setVisible('plugin', 'view', userId, [OBJECT.id]);
    }

    it('require resolves', async () => {
        await expect(build(userActor('u-operator'), fixtureFor('u-operator')).service.require(OBJECT, 'view')).resolves.toBeUndefined();
    });

    it('canAccess is true', async () => {
        await expect(build(userActor('u-operator'), fixtureFor('u-operator')).service.canAccess(OBJECT, 'view')).resolves.toBe(true);
    });

    it('listVisibleIds returns the tuple-walk result', async () => {
        await expect(build(userActor('u-operator'), fixtureFor('u-operator')).service.listVisibleIds('plugin', 'view')).resolves.toEqual({
            ids: [OBJECT.id],
            truncated: false,
        });
    });

    it('permissionsForResource includes the granted permission', async () => {
        const result = await build(userActor('u-operator'), fixtureFor('u-operator')).service.permissionsForResource(OBJECT);
        expect(result).toContain('view');
    });
});

describe('AccessControlService: roleless user, no tuples', () => {
    it('require throws 403', async () => {
        await expectForbidden(build(userActor('u-nobody')).service.require(OBJECT, 'view'));
    });

    it('canAccess is false', async () => {
        await expect(build(userActor('u-nobody')).service.canAccess(OBJECT, 'view')).resolves.toBe(false);
    });

    it('listVisibleIds returns an empty, non-truncated result', async () => {
        await expect(build(userActor('u-nobody')).service.listVisibleIds('plugin', 'view')).resolves.toEqual({ ids: [], truncated: false });
    });

    it('permissionsForResource returns nothing', async () => {
        await expect(build(userActor('u-nobody')).service.permissionsForResource(OBJECT)).resolves.toEqual([]);
    });
});

describe('AccessControlService: user actor with an empty actorId', () => {
    it('listVisibleIds short-circuits without consulting PermissionsService', async () => {
        const { service, permissions } = build(userActor(undefined));
        await expect(service.listVisibleIds('plugin', 'view')).resolves.toEqual({ ids: [], truncated: false });
        expect(permissions.listObjects).not.toHaveBeenCalled();
    });

    it('require denies', async () => {
        await expectForbidden(build(userActor(undefined)).service.require(OBJECT, 'view'));
    });

    it('permissionsForResource returns nothing', async () => {
        await expect(build(userActor(undefined)).service.permissionsForResource(OBJECT)).resolves.toEqual([]);
    });
});

describe('AccessControlService: canAccess and require both consult rolesGrant independently', () => {
    // canAccess is the filter-check path (no audit event); require is the
    // enforcement path (records an audit event on role-granted access). This
    // does not assert on the audit sink; it just pins that both independently
    // resolve the same way for a role-granted permission, since the two do not
    // share a code path.
    it('both resolve true for a listener over platform:view', async () => {
        const platformObject: ObjectRef = { namespace: 'platform', id: 'main' };
        const { service } = build(userActor('u-listener', ['listener']));
        await expect(service.canAccess(platformObject, 'view')).resolves.toBe(true);
        await expect(service.require(platformObject, 'view')).resolves.toBeUndefined();
    });
});
