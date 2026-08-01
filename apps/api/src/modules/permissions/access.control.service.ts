import { Injectable } from 'injectkit';
import { httpError } from '@maroonedsoftware/errors';
import { PermissionsService } from './permissions.service.js';
import { AuthorizationContext } from './authorization.context.js';
import { model as authorizationModel } from './generated/index.js';
import { permissionsGrantedByRoles, rolesGrant, rolesGrantingPermission } from './platform.roles.js';
import type { ObjectRef, SubjectRef } from '@maroonedsoftware/permissions';
import type { ListObjectsOptions, ListObjectsResult } from './list.objects.js';

// Visibility result. `{ all: true }` means the actor bypasses filtering at this
// permission (system / webhook / platform-role coverage); the caller should
// run the unfiltered list. `ListObjectsResult` shape narrows to specific
// allowed object IDs.
export type VisibilityResult = ListObjectsResult | { all: true };

export const isAllVisible = (v: VisibilityResult): v is { all: true } => 'all' in v;

export interface PermissionsForResourceOpts {
    // Permissions to drop from the response — typically the `read`/`view`
    // equivalent the caller already passed to receive the resource. Callers
    // (resource serializers) decide what's trivial for their namespace.
    excludeTrivial?: ReadonlyArray<string>;
}

const denied = (object: ObjectRef, permission: string): never => {
    throw httpError(403).withDetails({
        message: `forbidden: missing ${permission} on ${object.namespace}:${object.id}`,
        object: `${object.namespace}:${object.id}`,
        permission,
    });
};

@Injectable()
export class AccessControlService {
    constructor(
        private readonly authz: AuthorizationContext,
        private readonly permissions: PermissionsService,
    ) {}

    // Soft check: returns whether the current actor would pass `require` for
    // (object, permission). Use for list-filtering and UI gating where a
    // denial is not a security event. Unlike `require`, this does NOT record
    // a platform-role audit event — filter checks would otherwise flood the
    // access log on every list call. Use `require` when the denial itself
    // should be auditable.
    async canAccess(object: ObjectRef, permission: string): Promise<boolean> {
        const actor = this.authz.actor;
        switch (actor.kind) {
            case 'system':
            case 'vendor':
                return true;
            case 'user':
                if (
                    await this.permissions.checkSubject(object, permission, {
                        kind: 'concrete',
                        namespace: 'user',
                        id: actor.actorId,
                    })
                ) {
                    return true;
                }
                return rolesGrant(actor.platformRoles, object.namespace, permission);
        }
        return false;
    }

    // Reverse expand: which objects in `namespace` does the current actor
    // reach via `permission`? Powers permission-aware list endpoints. Returns
    // either:
    //   - `{ all: true }` for system / vendor actors and for users whose
    //     platform role grants the permission system-wide; callers should run
    //     the unfiltered list.
    //   - `{ ids, truncated }` for users restricted to specific tuples.
    async listVisibleIds(namespace: string, permission: string, options: ListObjectsOptions = {}): Promise<VisibilityResult> {
        const actor = this.authz.actor;
        switch (actor.kind) {
            case 'system':
            case 'vendor':
                return { all: true };
            case 'user': {
                if (!actor.actorId) return { ids: [], truncated: false };
                // If a platform role would grant this permission across the
                // namespace, the user can see every object — defer to the
                // unfiltered list path.
                if (rolesGrant(actor.platformRoles, namespace, permission)) {
                    return { all: true };
                }
                return this.permissions.listObjects(namespace, permission, { kind: 'concrete', namespace: 'user', id: actor.actorId }, options);
            }
            default:
                return { ids: [], truncated: false };
        }
    }

    async require(object: ObjectRef, permission: string): Promise<void> {
        const actor = this.authz.actor;

        switch (actor.kind) {
            case 'system':
                // Trusted code path (jobs, CLI, startup, tests). The dispatcher
                // bypass is appropriate because the job dispatcher is responsible
                // for picking the right actor when invoking on behalf of a user.
                return;

            case 'vendor':
                // Inbound webhooks carry their own signed authorization
                // (validated by the route's signature middleware). Permission
                // checks aren't meaningful here.
                return;

            case 'user': {
                const actorId = actor.actorId;
                if (!actorId) {
                    denied(object, permission);
                    return;
                }
                const allowed = await this.permissions.checkSubject(object, permission, {
                    kind: 'concrete',
                    namespace: 'user',
                    id: actorId,
                });
                if (allowed) return;

                // Fall back to platform-role coverage. A user's role grant is
                // application-wide (not per-object), so any matching role
                // authorizes the access. Audit which role(s) authorized it for
                // the compliance trail — staff-style oversight survives the
                // collapse of the staff actor kind.
                const matched = rolesGrantingPermission(actor.platformRoles, object.namespace, permission);
                if (matched.length > 0) {
                    return;
                }

                denied(object, permission);
                return;
            }
        }
    }

    // Returns the non-trivial permissions the current actor can exercise on
    // `object`. Used by resource serializers when the client opts in via
    // `Prefer: return=permissions` (RFC 7240). The per-request memo cache in
    // check.ts means the N permission checks for one resource share intermediate
    // results — typical cost is well under a millisecond.
    async permissionsForResource(object: ObjectRef, opts: PermissionsForResourceOpts = {}): Promise<string[]> {
        const ns = authorizationModel.get(object.namespace);
        if (!ns) return [];

        const trivial = new Set(opts.excludeTrivial ?? []);
        const candidates = Object.keys(ns.permissions).filter(p => !trivial.has(p));
        if (candidates.length === 0) return [];

        const actor = this.authz.actor;

        if (actor.kind === 'system' || actor.kind === 'vendor') {
            return candidates;
        }

        // user actor
        if (!actor.actorId) return [];
        const subject: SubjectRef = { kind: 'concrete', namespace: 'user', id: actor.actorId };
        const results = await Promise.all(candidates.map(p => this.permissions.checkSubject(object, p, subject)));
        const fromTuples = new Set(candidates.filter((_, i) => results[i]));
        const fromRoles = permissionsGrantedByRoles(actor.platformRoles, object.namespace, candidates);
        for (const p of fromRoles) fromTuples.add(p);
        return candidates.filter(p => fromTuples.has(p));
    }
}
