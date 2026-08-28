import { Container, Injectable, ScopedContainer } from 'injectkit';
import { Job, JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { overrideJobActor } from './job.authorization.js';
import { runInTrace } from '#modules/shared/trace.context.js';
import { recordingSpan } from '#modules/shared/trace.spans.js';
import { takeParentTrace } from './job.trace.payload.js';

/**
 * The base class for a job that deliberately does NOT wrap itself in a
 * transaction. {@link TransactionalJob} is the other half of the pair.
 *
 * ## Why a job would refuse a transaction
 *
 * Most of the station's jobs are a walk with something slow in the middle of
 * each step: a network fetch, an audio decode, a model generating a sentence.
 * Wrapping one of those pins a runtime-pool connection and holds a single
 * snapshot open for the whole length of the walk, which is minutes. Each item
 * settles on its own instead, and the writes are idempotent, so an overlapping
 * run costs duplicated work rather than a wrong row.
 *
 * ## What this class is for
 *
 * Exactly one thing, and it is the thing that was easy to forget: **a plain job
 * still runs as somebody**. `TransactionalJob` installs the actor as part of
 * opening its transaction, and nothing in a plain job's scope does it, so every
 * one of these had to call {@link overrideJobActor} as the first line of `run`.
 * All ten did, each above its own copy of the same comment explaining why the
 * cast to `ScopedContainer` is unavoidable. That is now here, once.
 *
 * ## Unlike `TransactionalJob`, constructor injection is fine
 *
 * That class has to forbid it: the runner resolves the job BEFORE `run`, so
 * anything constructor-injected would be built against the pooled `Kysely<DB>`
 * before the transaction override lands. There is no such override here.
 * {@link overrideJobActor} changes attribution and never an authorization
 * outcome (see its note), so a service resolved before it is the same service
 * after it. Subclasses take their collaborators in the constructor as usual and
 * pass the three shared ones up:
 *
 * ```typescript
 * @Injectable()
 * export class ArtCacheJob extends PlainJob<ArtCachePayload> {
 *     constructor(
 *         private readonly artCache: ArtCacheService,
 *         context: JobContext,
 *         container: Container,
 *         logger: Logger,
 *     ) {
 *         super(context, container, logger);
 *     }
 *
 *     protected async execute(payload?: ArtCachePayload, signal?: AbortSignal): Promise<void> {
 *         // `this.context`, `this.logger` and `this.container` are all here.
 *     }
 * }
 * ```
 *
 * The `@Injectable()` on this class plays the same role it plays on
 * `TransactionalJob`: it puts `design:paramtypes` on the prototype chain for any
 * subclass that declares no constructor of its own.
 */
@Injectable()
export abstract class PlainJob<Payload extends object = object> implements Job<Payload> {
    constructor(
        protected readonly context: JobContext,
        // `Container` resolves to the container doing the resolving, which for a job is the
        // runner's per-execution scope. `ScopedContainer` is a type alias rather than a token, so
        // reaching the scope's `override` can only be the cast made in `run`.
        protected readonly container: Container,
        protected readonly logger: Logger,
    ) {}

    /**
     * The trace opens around `execute` rather than around the whole method, so the actor override is
     * outside it. That is deliberate and it is the only ordering that reads right: the override is
     * setup for the work, not part of it, and a line logged while installing an actor belongs to
     * the runner rather than to the decision. `JobContext.id` is the id because it already is the
     * correlation id — see {@link runInTrace}.
     *
     * The payload arrives carrying whichever decision enqueued this one, and `execute` never sees
     * it: {@link takeParentTrace} lifts it out and hands the job back the payload it was sent. The
     * `job.run` span is what records the edge, and it is recorded whether or not this job calls
     * anything — a decision that made no plugin calls would otherwise leave no trace of having
     * happened, which is the case where knowing what caused it is most of the answer.
     */
    async run(payload?: Payload, signal?: AbortSignal): Promise<void> {
        overrideJobActor(this.container as ScopedContainer, this.context);

        const { payload: own, parent } = takeParentTrace(payload);
        const trace = { id: this.context.id, kind: this.context.name, ...(parent === undefined ? {} : { parent }) };

        await runInTrace(trace, async () => await recordingSpan('job.run', this.context.name, async () => await this.execute(own, signal)));
    }

    /**
     * The job body, with the actor already installed.
     *
     * @param payload - The payload as sent. Optional because cron sends `{}` and
     *                  several of these jobs take nothing at all.
     * @param signal - Aborted on cancellation or runner shutdown. Forward it to
     *                 anything long-running; an ignored signal cannot be interrupted.
     */
    protected abstract execute(payload?: Payload, signal?: AbortSignal): Promise<void>;
}
