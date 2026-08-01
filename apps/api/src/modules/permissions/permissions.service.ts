import { Injectable } from 'injectkit';
import {
    AuthorizationModel,
    CheckMetricsSink,
    PermissionsTupleRepository,
    check,
    type ObjectRef,
    type RelationTuple,
    type SubjectRef,
} from '@maroonedsoftware/permissions';
//import type { BatchCheckRequest, BatchCheckResponse, CheckRequest, CheckResponse } from './types/permissions.js';
import { listObjects, type ListObjectsOptions, type ListObjectsResult, type ReverseExpandTupleRepo } from './list.objects.js';
import { AuthorizationContext } from './authorization.context.js';

@Injectable()
export class PermissionsService {
    constructor(
        private readonly model: AuthorizationModel,
        private readonly repo: PermissionsTupleRepository,
        private readonly metricsSink: CheckMetricsSink,
        private readonly authorizationContext: AuthorizationContext,
    ) {}

    // The public check endpoints would otherwise be an authorization-graph oracle: any user could
    // probe whether ANY subject reaches ANY object. Restrict `subject` to the caller themselves
    // (self-checks power UI gating) unless the caller is platform staff. System/vendor actors are
    // trusted callers and pass through.
    // private assertMaySeeSubject(subject: SubjectRef): void {
    //     const actor = this.authorizationContext.actor;
    //     if (actor.kind !== 'user') return;
    //     const isSelf = subject.kind === 'concrete' && subject.namespace === 'user' && !!actor.actorId && subject.id === actor.actorId;
    //     if (!isSelf) {
    //         this.authorizationContext.requirePlatformRole('admin');
    //     }
    // }

    // Public ContractKit endpoint — POST /permissions/check.
    // async check(body: CheckRequest): Promise<CheckResponse> {
    //     this.assertMaySeeSubject(body.subject);
    //     const allowed = await check(this.model, this.repo, body.object, body.permission, body.subject, this.metricsSink);
    //     return { allowed };
    // }

    // // Public ContractKit endpoint — POST /permissions/batch-check.
    // async batchCheck(body: BatchCheckRequest): Promise<BatchCheckResponse> {
    //     for (const c of body.checks) {
    //         this.assertMaySeeSubject(c.subject);
    //     }
    //     const results: CheckResponse[] = await Promise.all(
    //         body.checks.map(async c => ({
    //             allowed: await check(this.model, this.repo, c.object, c.permission, c.subject, this.metricsSink),
    //         })),
    //     );
    //     return { results };
    // }

    // Lower-level Check primitive used by AccessControlService. Returns the
    // raw boolean instead of throwing — the dispatcher decides what to do
    // with a denial (record an event, throw, fall through to a grant).
    async checkSubject(object: ObjectRef, permission: string, subject: SubjectRef): Promise<boolean> {
        return check(this.model, this.repo, object, permission, subject, this.metricsSink);
    }

    // Reverse expand: which objects in `namespace` does `subject` reach via
    // `permission`? Powers permission-aware list endpoints. The injected repo
    // must implement the reverse-lookup methods declared on
    // ReverseExpandTupleRepo — crescenda's CrescendaPermissionsTupleRepository
    // does. Throws on non-concrete subjects.
    async listObjects(namespace: string, permission: string, subject: SubjectRef, options: ListObjectsOptions = {}): Promise<ListObjectsResult> {
        return listObjects(this.model, this.repo as ReverseExpandTupleRepo, namespace, permission, subject, {
            sink: this.metricsSink,
            ...options,
        });
    }

    // Helper for paired writes from domain services. Inherits the request
    // transaction opened by audit.context.middleware — no manual wrapping.
    async writeDirect(tuples: RelationTuple[], actorId?: string): Promise<void> {
        await this.repo.write(tuples, actorId);
    }

    async deleteDirect(tuples: RelationTuple[]): Promise<void> {
        await this.repo.delete(tuples);
    }
}
