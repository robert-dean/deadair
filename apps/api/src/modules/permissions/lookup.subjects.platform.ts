import { sql, type RawBuilder } from 'kysely';
import { PLATFORM_NAMESPACE, PLATFORM_OBJECT_ID, PLATFORM_ROLES } from './platform.roles.js';

// Mirrors patternMatches in platform.roles.ts, but kept local so this helper
// stays a pure-SQL adapter with no test-time dependency surprises.
const patternMatches = (pattern: string, namespace: string, permission: string): boolean => {
    const colon = pattern.indexOf(':');
    if (colon === -1) return false;
    const ns = pattern.slice(0, colon);
    const perm = pattern.slice(colon + 1);
    return (ns === '*' || ns === namespace) && (perm === '*' || perm === permission);
};

/**
 * SQL fragment producing `user_id text` rows for every user whose platform
 * role grants `(namespace, permission)`. Pattern resolution happens once in
 * TypeScript — the emitted SQL just selects subjects of the matched
 * role-relations on `(platform, main)`. Returns null when no role covers the
 * pair, so callers can skip the UNION branch entirely.
 */
export const platformRoleSubjects = (namespace: string, permission: string): RawBuilder<{ user_id: string }> | null => {
    const matched: string[] = [];
    for (const [role, patterns] of Object.entries(PLATFORM_ROLES)) {
        if (patterns.some(p => patternMatches(p, namespace, permission))) {
            matched.push(role);
        }
    }
    if (matched.length === 0) return null;

    const relationList = sql.join(matched.map(r => sql`${r}`));
    return sql<{ user_id: string }>`
        SELECT t.subject_id AS user_id
        FROM permissions.relation_tuples t
        WHERE t.object_namespace = ${PLATFORM_NAMESPACE}
          AND t.object_id = ${PLATFORM_OBJECT_ID}
          AND t.relation IN (${relationList})
          AND t.subject_namespace = 'user'
          AND t.subject_relation = ''
          AND t.subject_id <> '*'
    `;
};
