import type { RelationTuple } from '@maroonedsoftware/permissions';
import { oauthgrant } from '#modules/permissions/generated/index.js';
import { PLATFORM_NAMESPACE, PLATFORM_OBJECT_ID } from '#modules/permissions/platform.roles.js';

/**
 * A connected app's grant as an object in the permissions model, with tuples DERIVED from its row
 * rather than stored.
 *
 * A grant's scope already lives in `oauth_grants.scope`: the OAuth library writes it when the app
 * exchanges its code and rewrites it when the person approves the app again. Stored tuples would be a
 * second copy to keep in step with that on every approval, so `DeadairPermissionsTupleRepository`
 * answers the `oauthgrant` namespace from the row instead, and the rule itself (never more than the
 * owner, `manage` implying `view`) stays in `core.perm` beside the API key's identical one.
 */

/** The namespace a grant is an object in, as `data/permissions/core.perm` declares it. */
export const OAUTHGRANT_NAMESPACE = 'oauthgrant';

const SCOPE_PREFIX = 'scoped_';

/** A relation on the `oauthgrant` namespace, exactly as `core.perm` spells it. */
type OAuthGrantRelation = keyof typeof oauthgrant.relations;

type ScopeOf<Relation> = Relation extends `${typeof SCOPE_PREFIX}${infer Scope}` ? Scope : never;

/** One station scope a grant may hold: `view` or `manage`, from the `scoped_*` relations. */
export type OAuthGrantScope = ScopeOf<OAuthGrantRelation>;

const isScopeRelation = (relation: string): relation is `${typeof SCOPE_PREFIX}${OAuthGrantScope}` => relation.startsWith(SCOPE_PREFIX);

/** Every station scope a grant may hold, in the order `core.perm` declares them. */
export const OAUTH_GRANT_SCOPES: ReadonlyArray<OAuthGrantScope> = Object.keys(oauthgrant.relations)
    .filter(isScopeRelation)
    .map(relation => relation.slice(SCOPE_PREFIX.length) as OAuthGrantScope);

export const isOAuthGrantScope = (value: string): value is OAuthGrantScope => (OAUTH_GRANT_SCOPES as ReadonlyArray<string>).includes(value);

/** What the repository reads off a grant row to derive its tuples. */
export interface GrantTupleSource {
    id: string;
    actorId: string;
    scope: ReadonlyArray<string>;
    revoked: boolean;
}

/**
 * The tuples that make a grant what it is: its owner, the station it hangs off, and one `scoped_*`
 * relation per station scope in its row, written for the owner. A revoked grant has none, so a check
 * against it fails however the session that carries it came to still be alive. A scope word the model
 * does not declare (`mcp`, say) derives nothing.
 */
export const grantTuples = (grant: GrantTupleSource): RelationTuple[] => {
    if (grant.revoked) return [];
    const object = { namespace: OAUTHGRANT_NAMESPACE, id: grant.id };
    const owner = { kind: 'concrete' as const, namespace: 'user', id: grant.actorId };
    return [
        { object, relation: 'owner', subject: owner },
        { object, relation: 'station', subject: { kind: 'concrete', namespace: PLATFORM_NAMESPACE, id: PLATFORM_OBJECT_ID } },
        ...grant.scope.filter(isOAuthGrantScope).map(scope => ({ object, relation: `${SCOPE_PREFIX}${scope}`, subject: owner })),
    ];
};
