import type { AuthorizationModel, UsersetExpr } from '@maroonedsoftware/permissions';
import { sql, type Expression, type RawBuilder } from 'kysely';
import { platformRoleSubjects } from './lookup.subjects.platform.js';

const MAX_DEPTH = 32;

export interface LookupSubjectsOptions {
    /** Alias for the terminal CTE. Default: `lookup_subjects`. */
    alias?: string;
}

interface BuildCtx {
    model: AuthorizationModel;
    visiting: Set<string>;
}

// A pre-built closure that, given a SQL expression for the root object id,
// emits a SELECT producing `user_id text` rows. Closures are built once during
// walker traversal and substituted at every nesting site (root call, lateral
// joins on tupleToUserset parents, userset-subject expansions).
type SubjectsBuilder = (objectId: Expression<string>) => RawBuilder<{ user_id: string }>;

type ParsedSubjectType =
    | { kind: 'concrete'; namespace: string }
    | { kind: 'wildcard'; namespace: string }
    | { kind: 'userset'; namespace: string; relation: string };

// SubjectType strings per @maroonedsoftware/permissions:
//   "<ns>"          — concrete (e.g. "user", "org")
//   "<ns>.*"        — wildcard (e.g. "user.*")
//   "<ns>.<rel>"    — userset  (e.g. "org.member")
const parseSubjectType = (s: string): ParsedSubjectType => {
    if (s.endsWith('.*')) return { kind: 'wildcard', namespace: s.slice(0, -2) };
    const dot = s.indexOf('.');
    if (dot === -1) return { kind: 'concrete', namespace: s };
    return { kind: 'userset', namespace: s.slice(0, dot), relation: s.slice(dot + 1) };
};

const emptySelect = (): RawBuilder<{ user_id: string }> => sql<{ user_id: string }>`SELECT NULL::text AS user_id WHERE FALSE`;

const unionAll = (parts: ReadonlyArray<RawBuilder<{ user_id: string }>>): RawBuilder<{ user_id: string }> => {
    if (parts.length === 0) return emptySelect();
    if (parts.length === 1) return parts[0]!;
    let acc = sql<{ user_id: string }>`(${parts[0]!})`;
    for (let i = 1; i < parts.length; i++) {
        acc = sql<{ user_id: string }>`${acc} UNION ALL (${parts[i]!})`;
    }
    return acc;
};

const buildPermission = (ctx: BuildCtx, namespace: string, relOrPerm: string, depth: number): SubjectsBuilder => {
    if (depth > MAX_DEPTH) return () => emptySelect();
    const key = `${namespace}#${relOrPerm}`;
    if (ctx.visiting.has(key)) return () => emptySelect();
    ctx.visiting.add(key);
    try {
        const expr = ctx.model.resolve(namespace, relOrPerm);
        return buildExpr(ctx, namespace, relOrPerm, expr, depth);
    } finally {
        ctx.visiting.delete(key);
    }
};

const buildExpr = (ctx: BuildCtx, namespace: string, relation: string, expr: UsersetExpr, depth: number): SubjectsBuilder => {
    switch (expr.kind) {
        case 'direct':
            return buildDirect(ctx, namespace, relation);

        case 'computed':
            return buildPermission(ctx, namespace, expr.relation, depth + 1);

        case 'union': {
            const children = expr.children.map(c => buildExpr(ctx, namespace, relation, c, depth));
            return oid => unionAll(children.map(c => c(oid)));
        }

        case 'intersection': {
            if (expr.children.length === 0) return () => emptySelect();
            const children = expr.children.map(c => buildExpr(ctx, namespace, relation, c, depth));
            return oid => {
                let acc = sql<{ user_id: string }>`(${children[0]!(oid)})`;
                for (let i = 1; i < children.length; i++) {
                    acc = sql<{ user_id: string }>`${acc} INTERSECT (${children[i]!(oid)})`;
                }
                return acc;
            };
        }

        case 'exclusion': {
            const base = buildExpr(ctx, namespace, relation, expr.base, depth);
            const sub = buildExpr(ctx, namespace, relation, expr.subtract, depth);
            return oid => sql<{ user_id: string }>`(${base(oid)}) EXCEPT (${sub(oid)})`;
        }

        case 'tupleToUserset':
            return buildTupleToUserset(ctx, namespace, expr.tupleRelation, expr.computedRelation, depth);
    }
};

const buildDirect = (ctx: BuildCtx, namespace: string, relation: string): SubjectsBuilder => {
    const ns = ctx.model.get(namespace);
    const relDef = ns?.relations[relation];
    const subjectTypes = (relDef?.subjects ?? []).map(parseSubjectType);

    // Concrete-user subjects (the common case): a stored tuple with
    // subject_namespace='user' carries a person id directly.
    const hasUserConcrete = subjectTypes.some(s => s.kind === 'concrete' && s.namespace === 'user');

    // Wildcard-user subjects: a stored tuple {subject_id='*', subject_namespace='user'}
    // grants any concrete user. Expand to every persons row when present.
    const hasUserWildcard = subjectTypes.some(s => s.kind === 'wildcard' && s.namespace === 'user');

    // Userset subjects (e.g. ['org.member']): a stored tuple {subject_namespace=ns,
    // subject_id=parent_id, subject_relation=rel} grants the subjects of
    // (ns, rel) on parent_id. Pre-build the sub-builder for each declared type.
    const usersetBranches = subjectTypes
        .filter((s): s is Extract<ParsedSubjectType, { kind: 'userset' }> => s.kind === 'userset')
        .map(s => ({
            ns: s.namespace,
            rel: s.relation,
            builder: buildPermission(ctx, s.namespace, s.relation, 0),
        }));

    return objectId => {
        const parts: RawBuilder<{ user_id: string }>[] = [];

        if (hasUserConcrete) {
            parts.push(sql<{ user_id: string }>`
                SELECT t.subject_id AS user_id
                FROM permissions.relation_tuples t
                WHERE t.object_namespace = ${namespace}
                  AND t.object_id = ${objectId}
                  AND t.relation = ${relation}
                  AND t.subject_namespace = 'user'
                  AND t.subject_relation = ''
                  AND t.subject_id <> '*'
            `);
        }

        if (hasUserWildcard) {
            // EXISTS gate avoids the cross-product when no wildcard tuple is stored.
            parts.push(sql<{ user_id: string }>`
                SELECT p.id::text AS user_id
                FROM identity.persons p
                WHERE EXISTS (
                    SELECT 1 FROM permissions.relation_tuples w
                    WHERE w.object_namespace = ${namespace}
                      AND w.object_id = ${objectId}
                      AND w.relation = ${relation}
                      AND w.subject_namespace = 'user'
                      AND w.subject_id = '*'
                )
            `);
        }

        for (const us of usersetBranches) {
            parts.push(sql<{ user_id: string }>`
                SELECT inner_us.user_id
                FROM permissions.relation_tuples us_walk
                JOIN LATERAL (${us.builder(sql.ref<string>('us_walk.subject_id'))}) inner_us ON TRUE
                WHERE us_walk.object_namespace = ${namespace}
                  AND us_walk.object_id = ${objectId}
                  AND us_walk.relation = ${relation}
                  AND us_walk.subject_namespace = ${us.ns}
                  AND us_walk.subject_relation = ${us.rel}
            `);
        }

        return unionAll(parts);
    };
};

const buildTupleToUserset = (
    ctx: BuildCtx,
    childNamespace: string,
    tupleRelation: string,
    computedRelation: string,
    depth: number,
): SubjectsBuilder => {
    const childNs = ctx.model.get(childNamespace);
    const tupleRel = childNs?.relations[tupleRelation];
    const subjectTypes = (tupleRel?.subjects ?? []).map(parseSubjectType);

    // tupleToUserset walks concrete parent subjects only — userset/wildcard
    // subjects on a parent relation aren't structured for reverse walks.
    // Mirrors list.objects.ts reverseTupleToUserset.
    const branches = subjectTypes
        .filter((s): s is Extract<ParsedSubjectType, { kind: 'concrete' }> => s.kind === 'concrete')
        .map(p => {
            const parentNs = ctx.model.get(p.namespace);
            if (!parentNs) return null;
            const hasRelOrPerm = computedRelation in parentNs.relations || computedRelation in parentNs.permissions;
            if (!hasRelOrPerm) return null;
            return { ns: p.namespace, builder: buildPermission(ctx, p.namespace, computedRelation, depth + 1) };
        })
        .filter((b): b is { ns: string; builder: SubjectsBuilder } => b !== null);

    return objectId => {
        const parts = branches.map(
            b => sql<{ user_id: string }>`
                SELECT inner_t.user_id
                FROM permissions.relation_tuples walk
                JOIN LATERAL (${b.builder(sql.ref<string>('walk.subject_id'))}) inner_t ON TRUE
                WHERE walk.object_namespace = ${childNamespace}
                  AND walk.object_id = ${objectId}
                  AND walk.relation = ${tupleRelation}
                  AND walk.subject_namespace = ${b.ns}
                  AND walk.subject_relation = ''
            `,
        );
        return unionAll(parts);
    };
};

/**
 * Build the SQL body of a `lookup_subjects` CTE: a SELECT producing
 * `user_id text` rows for every user who holds `permission` on
 * `(namespace, objectId)` under `model`, with platform-role coverage UNION'd
 * in. Userset subjects (e.g. `org:abc#member`) are flattened to concrete
 * user IDs via recursive expansion of `(subject_namespace, subject_relation)`.
 *
 * Returns a RawBuilder ready to drop into `qb.with(alias, () => sqlBody)`.
 * The terminal SELECT wraps the union in `SELECT DISTINCT` to dedupe across
 * branches.
 */
export const buildLookupSubjectsSql = (
    model: AuthorizationModel,
    namespace: string,
    objectId: string,
    permission: string,
): RawBuilder<{ user_id: string }> => {
    const ctx: BuildCtx = { model, visiting: new Set() };
    const builder = buildPermission(ctx, namespace, permission, 0);
    // Parameterize objectId as a Postgres bind value.
    const oid: Expression<string> = sql<string>`${objectId}`;
    const permissionTree = builder(oid);
    const platformBranch = platformRoleSubjects(namespace, permission);

    const inner = platformBranch ? sql<{ user_id: string }>`(${permissionTree}) UNION ALL (${platformBranch})` : permissionTree;

    return sql<{ user_id: string }>`SELECT DISTINCT user_id FROM (${inner}) AS _ls_inner`;
};

// A Kysely query/select builder accepts `.with(name, factory)` where factory
// returns an Expression. We accept any such builder and return the same shape
// — typing the CTE alias through Kysely's `.with()` generic chain at this
// boundary would force callers to thread complex generic params for no
// practical gain. Use `any` here; callers reference the CTE via raw alias.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CteAttacher = (qb: any) => any;

/**
 * Composer pattern: returns a function that attaches the lookup-subjects CTE
 * to a Kysely query builder under `options.alias` (default `lookup_subjects`),
 * exposing one column `user_id text` for the caller to JOIN against.
 *
 * Usage:
 *   const attach = buildLookupSubjectsComposer(model, 'document', docId, 'read');
 *   const rows = await attach(db.selectFrom('identity.persons'))
 *       .innerJoin('lookup_subjects', 'lookup_subjects.user_id', 'identity.persons.id')
 *       .orderBy('identity.persons.id')
 *       .limit(20).offset(40)
 *       .selectAll('identity.persons')
 *       .execute();
 */
export const buildLookupSubjectsComposer = (
    model: AuthorizationModel,
    namespace: string,
    objectId: string,
    permission: string,
    options: LookupSubjectsOptions = {},
): CteAttacher => {
    const alias = options.alias ?? 'lookup_subjects';
    const sqlBody = buildLookupSubjectsSql(model, namespace, objectId, permission);
    return qb => qb.with(alias, () => sqlBody);
};

/**
 * All-persons composer used for system/vendor actors that bypass the
 * authorization gate. Produces the same `(user_id text)` shape as the real
 * lookup so callers can JOIN identically — but every persons row is yielded.
 * Use only when the caller is trusted (system/vendor); otherwise this leaks
 * the full user population.
 */
export const buildAllPersonsComposer = (options: LookupSubjectsOptions = {}): CteAttacher => {
    const alias = options.alias ?? 'lookup_subjects';
    const sqlBody = sql<{ user_id: string }>`SELECT id::text AS user_id FROM identity.persons`;
    return qb => qb.with(alias, () => sqlBody);
};

export const __testing = { MAX_DEPTH, parseSubjectType };
