import { Container, Injectable, ScopedContainer } from 'injectkit';
import { Kysely, sql } from 'kysely';
import { Job, JobContext } from '@maroonedsoftware/jobbroker';
import { KyselyTransactionConnectionProvider, PgBossConnectionProvider } from '@maroonedsoftware/jobbroker/pgboss';
import { DB } from '#modules/data/db.js';
import { overrideJobActor } from './job.authorization.js';
import { runInTrace } from '#modules/shared/trace.context.js';
import { recordingSpan } from '#modules/shared/trace.spans.js';
import { takeParentTrace } from './job.trace.payload.js';

/**
 * The job-side counterpart of `auditContextMiddleware`.
 *
 * `PgBossJobRunner` already gives every execution its own scoped container (the
 * job-side equivalent of a request scope) and disposes it once the job settles.
 * That scope is the seam: this base class opens a transaction on it, sets the
 * same `app.*` audit GUCs the request path sets, and installs the same
 * overrides — `Kysely<DB>` → the transaction, `PgBossConnectionProvider` → a
 * {@link KyselyTransactionConnectionProvider} bound to it, and
 * `AuthorizationContext` → the job's actor (see {@link overrideJobActor}).
 * Everything the job then resolves from the scope reads and writes on the
 * transaction, and any job it enqueues commits atomically with the work that
 * enqueued it.
 *
 * **Resolve collaborators inside `execute`, not in the constructor.** The runner
 * calls `scope.get(JobClass)` *before* `run`, so anything constructor-injected is
 * resolved (and, being `scoped`, cached in this scope) against the pooled
 * `Kysely<DB>` — before the override lands. The request path does not have this
 * problem because the middleware overrides before routing resolves anything. So
 * a concrete job takes only the container and pulls its services out of it once
 * the transaction is open:
 *
 * ```typescript
 * @Injectable()
 * export class ReconcileTracksJob extends TransactionalJob<{ playlistId: string }> {
 *     protected async execute(payload: { playlistId: string }): Promise<void> {
 *         const tracks = this.container.get(TracksService);
 *         await tracks.reconcile(payload.playlistId);
 *     }
 * }
 * ```
 *
 * A plain `@Injectable()` is enough, and the `@Injectable()` on this class is
 * what makes that true. A subclass with no constructor of its own emits no
 * `design:paramtypes`, so injectkit walks up the prototype chain looking for a
 * base that has some; decorating this class is what puts `[Container]` there for
 * it to find. Without it every subclass would have to repeat
 * `{ deps: [Container] }` and would fail loudly at first dequeue if it forgot.
 *
 * **This is opt-in per job, not a blanket wrapper**, and that is the other
 * difference from the request path. A request is short and the pool is sized for
 * one connection per in-flight request; a job can run for minutes. A long job
 * that wraps its whole body holds a runtime-pool connection and an open snapshot
 * the entire time. Jobs that do one bounded unit of work extend this; jobs that
 * loop over many items should instead transact per item.
 *
 * pg-boss acknowledges completion on its own connection, outside this
 * transaction, so delivery stays at-least-once: a crash between commit and ack
 * re-runs the job. Handlers still have to be idempotent.
 */
@Injectable()
export abstract class TransactionalJob<Payload extends object = object> implements Job<Payload> {
    constructor(protected readonly container: Container) {}

    async run(payload: Payload, signal?: AbortSignal): Promise<void> {
        const scope = this.container as ScopedContainer;
        const db = scope.get(Kysely<DB>);
        const context = scope.get(JobContext);

        // The parent comes off before anything else looks at the payload, and `execute` is handed
        // what the caller actually sent. See `job.trace.payload.ts`.
        const { payload: own, parent } = takeParentTrace(payload);
        const trace = { id: context.id, kind: context.name, ...(parent === undefined ? {} : { parent }) };

        // Outside the transaction rather than inside it, unlike `PlainJob` where there is no
        // transaction to be outside of. Opening one is part of what this job DOES — it is the whole
        // reason this class exists — so a line about the transaction failing belongs to the
        // decision, and a trace that started after `BEGIN` would not have it. The id is the same one
        // the `app.request_id` GUC below is about to be set to, deliberately: the trace and the
        // audit trail name a decision the same way or there is no point to either.
        //
        // The `job.run` span is outside the transaction for the same reason and measures the same
        // thing the trace covers, which includes the commit: a job whose work is fast and whose
        // commit is slow is a real shape and one this would otherwise report as fast.
        await runInTrace(trace, async () => {
            await recordingSpan('job.run', context.name, async () => {
                await db.transaction().execute(async trx => {
                    // Mirrors auditContextMiddleware. There is no user and no IP behind a
                    // job, so the queue name stands in as the actor and the job id as the
                    // correlation id — the same role `ctx.requestId` plays for a request.
                    await sql`
                        select set_config('app.actor_type', 'job', true),
                               set_config('app.actor_id', ${context.name}, true),
                               set_config('app.request_id', ${context.id}, true),
                               set_config('app.actor_ip', ${null}, true)
                    `.execute(trx);

                    scope.override(Kysely<DB>, trx);
                    scope.override(PgBossConnectionProvider, new KyselyTransactionConnectionProvider(trx));
                    // The DI-side counterpart of the GUCs above: same job, same identity,
                    // told to the permission model instead of to Postgres.
                    overrideJobActor(scope, context);

                    await this.execute(own, signal);
                });
            });
        });
    }

    /**
     * The job body, run inside the transaction with the scope's `Kysely<DB>` and
     * `PgBossConnectionProvider` already overridden. Throwing rolls the whole
     * execution back, including any jobs it enqueued.
     *
     * @param payload - The job's payload, as sent.
     * @param signal - Aborted on cancellation or runner shutdown. Forward it to
     *                 anything long-running; an ignored signal cannot be interrupted.
     */
    protected abstract execute(payload: Payload, signal?: AbortSignal): Promise<void>;
}
