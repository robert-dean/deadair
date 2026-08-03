// Platform roles map to permission patterns. A user holding `platform:main:<role>`
// gains the listed (namespace, permission) capabilities across every object,
// without needing per-resource tuples.
//
// Why this lives in TypeScript instead of the .perm DSL: Zanzibar's
// tuple-to-userset is per-object — there's no native way to say "this role
// applies across every object in a namespace" without inserting one tuple per
// resource. Application-level matching keeps the tuple store lean (one row per
// "Bob is an underwriter"), and the role config is the only thing that needs
// to change when a new role or permission is introduced.
//
// Patterns are `<namespace>:<permission>`; either side may be `*`. Matching is
// exact-or-wildcard, no globs.
//
// `admin` holds `'*:*'`. Operations that even an admin must not perform are
// blocked at the Policy layer rather than the Zanzibar layer, so the broad
// permission coverage here does not bypass those guards.
//
// INVARIANT: every name below must be a relation declared on the `platform`
// namespace in data/permissions/core.perm. The DSL is the source of truth — a
// role with no matching relation can never be held (nothing can write a tuple
// check() would walk), and a relation with no matching role here is dropped by
// `isPlatformRoleName` when the middleware builds the actor's role set. Adding
// a tier means editing both files.

export type PlatformRoleName = 'admin' | 'listener';

export const PLATFORM_ROLE_NAMES: ReadonlyArray<PlatformRoleName> = ['admin', 'listener'];

export const PLATFORM_NAMESPACE = 'platform';
export const PLATFORM_OBJECT_ID = 'main';

export const PLATFORM_ROLES: Readonly<Record<PlatformRoleName, ReadonlyArray<string>>> = {
    admin: ['*:*'],
    listener: ['platform:view', 'plugin:view'],
};

export const isPlatformRoleName = (value: string): value is PlatformRoleName => (PLATFORM_ROLE_NAMES as ReadonlyArray<string>).includes(value);

const patternMatches = (pattern: string, namespace: string, permission: string): boolean => {
    const colon = pattern.indexOf(':');
    if (colon === -1) return false;
    const ns = pattern.slice(0, colon);
    const perm = pattern.slice(colon + 1);
    return (ns === '*' || ns === namespace) && (perm === '*' || perm === permission);
};

// Returns true if any of the actor's roles grants `(namespace, permission)`.
// `roles` may be undefined for test fixtures that predate platformRoles —
// treat it as an empty set.
export const rolesGrant = (roles: ReadonlySet<PlatformRoleName> | undefined, namespace: string, permission: string): boolean => {
    if (!roles) return false;
    for (const role of roles) {
        const patterns = PLATFORM_ROLES[role];
        for (const pattern of patterns) {
            if (patternMatches(pattern, namespace, permission)) return true;
        }
    }
    return false;
};

// Returns the subset of roles that grant `(namespace, permission)`. Used by
// the audit pathway to attribute which role authorized a given access.
export const rolesGrantingPermission = (
    roles: ReadonlySet<PlatformRoleName> | undefined,
    namespace: string,
    permission: string,
): ReadonlyArray<PlatformRoleName> => {
    if (!roles) return [];
    const matched: PlatformRoleName[] = [];
    for (const role of roles) {
        const patterns = PLATFORM_ROLES[role];
        if (patterns.some(p => patternMatches(p, namespace, permission))) {
            matched.push(role);
        }
    }
    return matched;
};

// Returns the subset of `permissions` that any role grants on `namespace`.
// Used by `permissionsForResource` so the response reflects role-derived
// capabilities for a user actor.
export const permissionsGrantedByRoles = (
    roles: ReadonlySet<PlatformRoleName> | undefined,
    namespace: string,
    permissions: ReadonlyArray<string>,
): ReadonlyArray<string> => (roles ? permissions.filter(p => rolesGrant(roles, namespace, p)) : []);
