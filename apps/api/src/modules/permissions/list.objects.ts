import type {
    AuthorizationModel,
    CheckMetricsSink,
    ObjectRef,
    PermissionsTupleRepository,
    SubjectRef,
    UsersetExpr,
} from '@maroonedsoftware/permissions';
import { newCheckMetrics, noopMetricsSink } from '@maroonedsoftware/permissions';

const MAX_DEPTH = 32;

// Minimal repo contract: existing forward methods + the two new reverse ones.
// When this lifts into serverkit, these become abstract methods on
// PermissionsTupleRepository and this interface goes away.
export interface ReverseExpandTupleRepo extends PermissionsTupleRepository {
    listObjectsForSubject(namespace: string, relation: string, subject: SubjectRef): Promise<{ id: string }[]>;
    listChildrenByParent(childNamespace: string, relation: string, parent: ObjectRef): Promise<{ id: string }[]>;
}

export interface ListObjectsResult {
    ids: string[];
    truncated: boolean;
}

export interface ListObjectsOptions {
    limit?: number;
    sink?: CheckMetricsSink;
}

interface ExpandCtx {
    model: AuthorizationModel;
    repo: ReverseExpandTupleRepo;
    memo: Map<string, Set<string>>;
    visiting: Set<string>;
    metrics: ReturnType<typeof newCheckMetrics>;
}

const formatSubject = (s: SubjectRef): string => {
    switch (s.kind) {
        case 'concrete':
            return `${s.namespace}:${s.id}`;
        case 'wildcard':
            return `${s.namespace}:*`;
        case 'userset':
            return `${s.namespace}:${s.id}#${s.relation}`;
    }
};

const memoKey = (namespace: string, relOrPerm: string, subject: SubjectRef): string => `${namespace}#${relOrPerm}@${formatSubject(subject)}`;

/**
 * Reverse expand: given (`namespace`, `permission`, `subject`), return the set
 * of object IDs in `namespace` that the subject can access via `permission`
 * under the supplied {@link AuthorizationModel}. Mirrors `check`'s structure
 * but inverts each operator.
 *
 * Cardinality is bounded with an optional `limit`; the result reports
 * `truncated: true` when the limit was reached. Cycle and depth guards match
 * `check` (`MAX_DEPTH = 32`).
 *
 * Subject restrictions:
 *  - Only concrete subjects are accepted; wildcard/userset throws.
 *  - Stored userset subjects on tuples are NOT walked in this version. Use
 *    `check()` per row for that path until phase 2 lands.
 *
 * @throws {Error} If the namespace or permission isn't declared on the model,
 *   or if the subject kind is not `concrete`.
 */
export const listObjects = async (
    model: AuthorizationModel,
    repo: ReverseExpandTupleRepo,
    namespace: string,
    permission: string,
    subject: SubjectRef,
    options: ListObjectsOptions = {},
): Promise<ListObjectsResult> => {
    if (subject.kind !== 'concrete') {
        throw new Error(`listObjects requires a concrete subject (got ${subject.kind})`);
    }
    const sink = options.sink ?? noopMetricsSink;
    const ctx: ExpandCtx = {
        model,
        repo,
        memo: new Map(),
        visiting: new Set(),
        metrics: newCheckMetrics(),
    };
    const start = performance.now();
    const set = await expandInner(ctx, namespace, permission, subject, 0);
    ctx.metrics.durationMs = performance.now() - start;

    let truncated = false;
    let ids = Array.from(set);
    if (options.limit !== undefined && ids.length > options.limit) {
        ids = ids.slice(0, options.limit);
        truncated = true;
    }
    sink.record(ctx.metrics, { namespace, permission, allowed: ids.length > 0 });
    return { ids, truncated };
};

const expandInner = async (ctx: ExpandCtx, namespace: string, relOrPerm: string, subject: SubjectRef, depth: number): Promise<Set<string>> => {
    if (depth > ctx.metrics.maxDepth) ctx.metrics.maxDepth = depth;
    if (depth > MAX_DEPTH) {
        ctx.metrics.hitMaxDepth = true;
        return new Set();
    }

    const key = memoKey(namespace, relOrPerm, subject);
    const cached = ctx.memo.get(key);
    if (cached !== undefined) {
        ctx.metrics.cacheHits++;
        return cached;
    }
    if (ctx.visiting.has(key)) return new Set();
    ctx.visiting.add(key);

    let result: Set<string>;
    try {
        const expr = ctx.model.resolve(namespace, relOrPerm);
        result = await evaluate(ctx, namespace, relOrPerm, expr, subject, depth);
    } finally {
        ctx.visiting.delete(key);
    }
    ctx.memo.set(key, result);
    return result;
};

const evaluate = async (
    ctx: ExpandCtx,
    namespace: string,
    relation: string,
    expr: UsersetExpr,
    subject: SubjectRef,
    depth: number,
): Promise<Set<string>> => {
    switch (expr.kind) {
        case 'direct':
            return reverseDirect(ctx, namespace, relation, subject);

        case 'computed':
            return expandInner(ctx, namespace, expr.relation, subject, depth + 1);

        case 'tupleToUserset':
            return reverseTupleToUserset(ctx, namespace, expr.tupleRelation, expr.computedRelation, subject, depth);

        case 'union': {
            const out = new Set<string>();
            for (const c of expr.children) {
                const child = await evaluate(ctx, namespace, relation, c, subject, depth);
                for (const id of child) out.add(id);
            }
            return out;
        }

        case 'intersection': {
            // No short-circuit: we need every child's full set to intersect.
            if (expr.children.length === 0) return new Set();
            const sets = await Promise.all(expr.children.map(c => evaluate(ctx, namespace, relation, c, subject, depth)));
            // Sort by size and intersect against the smallest.
            sets.sort((a, b) => a.size - b.size);
            const [smallest, ...rest] = sets as [Set<string>, ...Set<string>[]];
            const out = new Set<string>();
            for (const id of smallest) {
                if (rest.every(s => s.has(id))) out.add(id);
            }
            return out;
        }

        case 'exclusion': {
            const [base, subtract] = await Promise.all([
                evaluate(ctx, namespace, relation, expr.base, subject, depth),
                evaluate(ctx, namespace, relation, expr.subtract, subject, depth),
            ]);
            const out = new Set<string>();
            for (const id of base) if (!subtract.has(id)) out.add(id);
            return out;
        }
    }
};

const reverseDirect = async (ctx: ExpandCtx, namespace: string, relation: string, subject: SubjectRef): Promise<Set<string>> => {
    ctx.metrics.tupleReads++;
    const rows = await ctx.repo.listObjectsForSubject(namespace, relation, subject);
    return new Set(rows.map(r => r.id));
};

const reverseTupleToUserset = async (
    ctx: ExpandCtx,
    childNamespace: string,
    tupleRelation: string,
    computedRelation: string,
    subject: SubjectRef,
    depth: number,
): Promise<Set<string>> => {
    // The tuple relation declares which parent namespaces are valid subjects.
    // For each candidate parent namespace, find which parent objects grant the
    // computed relation to our subject, then walk children that point at them.
    const childNs = ctx.model.get(childNamespace);
    if (!childNs) return new Set();
    const tupleRel = childNs.relations[tupleRelation];
    if (!tupleRel) return new Set();

    const parentNamespaces = new Set<string>();
    for (const s of tupleRel.subjects) {
        // SubjectType encoding: "<ns>", "<ns>:*", "<ns>#<rel>". Only concrete
        // namespaces are valid parents (userset/wildcard subjects can't be
        // walked back through tupleToUserset).
        if (s.includes('#') || s.endsWith(':*')) continue;
        parentNamespaces.add(s);
    }

    const out = new Set<string>();
    for (const parentNs of parentNamespaces) {
        // Skip if computedRelation isn't defined on this parent ns (mixed-ns
        // relations like `owner: [user, org#admin]` legitimately occur — the
        // walk just skips namespaces that can't satisfy it).
        const target = ctx.model.get(parentNs);
        if (!target) continue;
        if (!(computedRelation in target.relations) && !(computedRelation in target.permissions)) continue;

        const parentIds = await expandInner(ctx, parentNs, computedRelation, subject, depth + 1);
        for (const parentId of parentIds) {
            ctx.metrics.parentLookups++;
            const children = await ctx.repo.listChildrenByParent(childNamespace, tupleRelation, {
                namespace: parentNs,
                id: parentId,
            });
            for (const c of children) out.add(c.id);
        }
    }
    return out;
};

/**
 * Internal hook exposing module-private constants to tests.
 */
export const __testing = { MAX_DEPTH };
