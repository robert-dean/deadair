import { describe, expect, it } from 'vitest';

import {
    PLATFORM_ROLE_NAMES,
    PLATFORM_ROLES,
    isPlatformRoleName,
    permissionsGrantedByRoles,
    rolesGrant,
    rolesGrantingPermission,
} from '../../../src/modules/permissions/platform.roles.js';
import type { PlatformRoleName } from '../../../src/modules/permissions/platform.roles.js';

const PLUGIN_PERMISSIONS = ['view', 'configure', 'enable', 'oauth'];

describe('PLATFORM_ROLES table', () => {
    it('leaves admin holding the blanket wildcard', () => {
        expect(PLATFORM_ROLES.admin).toEqual(['*:*']);
    });

    // Regression guard for the role narrowing: namespace-wide `plugin:view`
    // used to force `listVisibleIds` down the `{ all: true }` path for every
    // listener, which made per-plugin `operator` tuple grants unable to scope
    // the list to just the plugins that actor actually holds a tuple for.
    // `listener` must carry only platform-level view, not blanket plugin view.
    it('grants listener only platform:view, no plugin coverage', () => {
        expect(PLATFORM_ROLES.listener).toEqual(['platform:view']);
        expect(PLATFORM_ROLES.listener).not.toContain('plugin:view');
    });

    // Cheap structural guards against a malformed entry silently never matching.
    it('lists every PLATFORM_ROLES key in PLATFORM_ROLE_NAMES', () => {
        for (const key of Object.keys(PLATFORM_ROLES)) {
            expect(PLATFORM_ROLE_NAMES).toContain(key);
        }
    });

    it('gives every pattern in the table a colon', () => {
        for (const patterns of Object.values(PLATFORM_ROLES)) {
            for (const pattern of patterns) {
                expect(pattern).toContain(':');
            }
        }
    });
});

describe('rolesGrant', () => {
    it.each(PLUGIN_PERMISSIONS)('grants admin plugin:%s via the wildcard', permission => {
        const roles = new Set<PlatformRoleName>(['admin']);
        expect(rolesGrant(roles, 'plugin', permission)).toBe(true);
    });

    it.each(PLUGIN_PERMISSIONS)('denies listener plugin:%s', permission => {
        const roles = new Set<PlatformRoleName>(['listener']);
        expect(rolesGrant(roles, 'plugin', permission)).toBe(false);
    });

    it('grants listener platform:view', () => {
        const roles = new Set<PlatformRoleName>(['listener']);
        expect(rolesGrant(roles, 'platform', 'view')).toBe(true);
    });

    it('grants plugin:view when a listener role is combined with admin', () => {
        const roles = new Set<PlatformRoleName>(['admin', 'listener']);
        expect(rolesGrant(roles, 'plugin', 'view')).toBe(true);
    });

    it('returns false for an empty role set', () => {
        expect(rolesGrant(new Set<PlatformRoleName>(), 'platform', 'view')).toBe(false);
    });

    it('returns false when roles is undefined', () => {
        expect(rolesGrant(undefined, 'platform', 'view')).toBe(false);
    });
});

describe('rolesGrantingPermission', () => {
    it('returns [admin] for a plugin permission held by an admin', () => {
        const roles = new Set<PlatformRoleName>(['admin']);
        expect(rolesGrantingPermission(roles, 'plugin', 'view')).toEqual(['admin']);
    });

    it('returns [] for a listener over a plugin permission', () => {
        const roles = new Set<PlatformRoleName>(['listener']);
        expect(rolesGrantingPermission(roles, 'plugin', 'view')).toEqual([]);
    });

    it('attributes platform:view to listener', () => {
        const roles = new Set<PlatformRoleName>(['listener']);
        expect(rolesGrantingPermission(roles, 'platform', 'view')).toEqual(['listener']);
    });

    it('attributes plugin:view to admin but not a co-held listener role', () => {
        const roles = new Set<PlatformRoleName>(['admin', 'listener']);
        expect(rolesGrantingPermission(roles, 'plugin', 'view')).toEqual(['admin']);
    });

    it('returns [] when roles is undefined', () => {
        expect(rolesGrantingPermission(undefined, 'plugin', 'view')).toEqual([]);
    });
});

describe('permissionsGrantedByRoles', () => {
    it('returns all four plugin permissions for an admin', () => {
        const roles = new Set<PlatformRoleName>(['admin']);
        expect(permissionsGrantedByRoles(roles, 'plugin', PLUGIN_PERMISSIONS).slice().sort()).toEqual([...PLUGIN_PERMISSIONS].sort());
    });

    it('returns none of the plugin permissions for a listener', () => {
        const roles = new Set<PlatformRoleName>(['listener']);
        expect(permissionsGrantedByRoles(roles, 'plugin', PLUGIN_PERMISSIONS)).toEqual([]);
    });

    it('keeps platform:view in a listener grant set', () => {
        const roles = new Set<PlatformRoleName>(['listener']);
        expect(permissionsGrantedByRoles(roles, 'platform', ['view'])).toEqual(['view']);
    });

    it('returns [] when roles is undefined', () => {
        expect(permissionsGrantedByRoles(undefined, 'platform', ['view'])).toEqual([]);
    });
});

describe('isPlatformRoleName', () => {
    it('accepts every declared platform role name', () => {
        for (const name of PLATFORM_ROLE_NAMES) {
            expect(isPlatformRoleName(name)).toBe(true);
        }
    });

    it("accepts 'admin' and 'listener' explicitly", () => {
        expect(isPlatformRoleName('admin')).toBe(true);
        expect(isPlatformRoleName('listener')).toBe(true);
    });

    it('rejects an unknown relation name', () => {
        expect(isPlatformRoleName('superuser')).toBe(false);
    });
});
