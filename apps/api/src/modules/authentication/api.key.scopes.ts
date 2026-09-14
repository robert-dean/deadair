import { apikey } from '#modules/permissions/generated/index.js';

/**
 * What an API key may be granted, derived from the `apikey` namespace in `data/permissions/core.perm`
 * rather than restated here.
 *
 * `defineNamespace` is generic over its relation names, so pdsl's output carries them as literal
 * types as well as runtime keys. A scope is whatever follows `scoped_` on a relation of that
 * namespace, which makes a new scope one line of `.perm` and a `pnpm build:permissions`, with the
 * API, the policies and the console picking it up from there. The contract's `ApiKeyScope` enum is
 * the one copy that cannot be derived, because ContractKit is a separate generator, and a test pins
 * it equal to {@link API_KEY_SCOPES}.
 */

const SCOPE_PREFIX = 'scoped_';

/** A relation on the `apikey` namespace, exactly as `core.perm` spells it. */
export type ApiKeyRelation = keyof typeof apikey.relations;

/**
 * The scope word a relation names, or `never` for one that is not a scope. A type parameter rather
 * than the alias directly, because only a naked type parameter distributes over a union: written
 * against `ApiKeyRelation` itself, `'owner'` failing the match would make the whole answer `never`.
 */
type ScopeOf<Relation> = Relation extends `${typeof SCOPE_PREFIX}${infer Scope}` ? Scope : never;

/** One scope word: `view` or `manage` today. */
export type ApiKeyScope = ScopeOf<ApiKeyRelation>;

/**
 * A permission a key can be checked for on its own object. `revoke` is left out because it asks
 * about the OWNER's right over the key, not about anything the key may do.
 */
export type ApiKeyGrant = Exclude<keyof typeof apikey.permissions, 'revoke'>;

const isScopeRelation = (relation: string): relation is `${typeof SCOPE_PREFIX}${ApiKeyScope}` => relation.startsWith(SCOPE_PREFIX);

/** Every scope a key may carry, in the order `core.perm` declares them. */
export const API_KEY_SCOPES: ReadonlyArray<ApiKeyScope> = Object.keys(apikey.relations)
    .filter(isScopeRelation)
    .map(relation => relation.slice(SCOPE_PREFIX.length) as ApiKeyScope);

/** The permissions a key is checked for once per request, in the order `core.perm` declares them. */
export const API_KEY_GRANTS: ReadonlyArray<ApiKeyGrant> = Object.keys(apikey.permissions).filter(
    (permission): permission is ApiKeyGrant => permission !== 'revoke',
);

export const isApiKeyScope = (value: string): value is ApiKeyScope => (API_KEY_SCOPES as ReadonlyArray<string>).includes(value);

/** The relation a scope is written as, for the key's owner: `view` → `scoped_view`. */
export const scopeRelation = (scope: ApiKeyScope): ApiKeyRelation => `${SCOPE_PREFIX}${scope}`;

/**
 * The scopes a key holds, read back from the relations its owner has on it.
 *
 * Unknown relations are dropped rather than trusted, so a hand-written tuple naming a scope that
 * `core.perm` does not declare is not a way to grant one. Sorted in declaration order, so two reads
 * of the same key compare equal.
 */
export const parseApiKeyScopes = (relations: ReadonlyArray<string>): ApiKeyScope[] => {
    const held = new Set(relations.filter(isScopeRelation).map(relation => relation.slice(SCOPE_PREFIX.length)));
    return API_KEY_SCOPES.filter(scope => held.has(scope));
};

/**
 * Which grant a key needs before a check for `permission` on some other object is allowed to run.
 *
 * The object-level `plugin:*` walks in `AccessControlService` take the owner as their subject, so the
 * `apikey` namespace never sees them and cannot narrow them. The rule there is the platform's own:
 * `view` is reading, and every other permission (`configure`, `enable`, `oauth`, `manage`) changes
 * something.
 */
export const grantForPermission = (permission: string): ApiKeyGrant => (permission === 'view' ? 'view' : 'manage');
