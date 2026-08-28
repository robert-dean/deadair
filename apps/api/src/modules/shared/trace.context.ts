import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Which decision the code currently running belongs to.
 *
 * ## The problem this exists for
 *
 * A refill makes a model call, which makes tool calls, which make provider calls, and the log lines
 * from all of them sit next to whatever else the station was doing in that second. Reading one
 * decision back means guessing from timestamps, and on a station that plans an hour ahead while
 * airing a break and enriching a catalog, the guess is wrong often enough not to be worth making.
 *
 * ## Why there is no new id
 *
 * There is already a correlation id at both roots and it is already in the audit trail: a job has
 * `JobContext.id`, a request has `ctx.requestId`, both land on `AuthorizationContext.request`, and
 * `audit.context.middleware` writes the request one into the `app.request_id` GUC. Inventing a
 * second id would mean two ways to name one decision and a join between them, which is the thing
 * this is supposed to remove. **The trace id IS the correlation id.**
 *
 * What was missing is only that it could not be READ from the places that spend the time.
 * `PluginInvoker` and `LlmService` are singletons reached from every scope; neither can ask a
 * request-scoped `AuthorizationContext` for anything, and threading an id through them would mean a
 * parameter on every host method and on every plugin call in between.
 *
 * ## Ambient, for the same reason the deadline is
 *
 * `plugin.invocation.deadline.ts` publishes a deadline this way and says why: the value has to
 * survive arbitrary plugin code in the middle, and there is no parameter that could carry it across
 * that gap. This is the same shape and the same gap. Module-level rather than `@Injectable` for the
 * same reason too — one store for the whole process, since a second instance is a second, empty
 * context, and it holds nothing to inject.
 *
 * ## Nothing decides anything on this
 *
 * A trace is a description of work, never an input to it. No branch may read `currentTrace()` to
 * choose behaviour, and nothing here may throw: code outside any trace is an ordinary state (a
 * timer a plugin set itself, a startup task, a test) and answers `undefined` rather than failing.
 */
export interface Trace {
    /** `JobContext.id` for a job, `ctx.requestId` for a request. Never generated here. */
    id: string;

    /**
     * What kind of decision this is, for a reader scanning a file rather than searching it: a queue
     * name (`director.refill_lineup`) or an HTTP route. Free text, and deliberately not an enum —
     * it is a label, and a vocabulary would have to be maintained by everything that opens a trace.
     */
    kind: string;

    /**
     * The decision that caused this one, when one did.
     *
     * A job that enqueues another job is two decisions, not one: they are separately scheduled,
     * separately retried, and may run minutes apart on different workers. So they get two ids and
     * this is the edge between them — the enrichment walk that queues a fact extraction is the
     * parent of it, and chasing a cause across that boundary used to mean chasing it by time.
     *
     * The IMMEDIATE parent only. A chain of three is two edges and a reader walks them; storing an
     * ancestry here would be a list that grows without bound on a job that re-enqueues itself.
     *
     * Absent on a cron job, on a request, and on anything enqueued at boot, all of which are roots.
     * A cron job in particular must never inherit one: it is scheduled once and fires forever, so a
     * parent on it would name a boot that happened weeks ago.
     */
    parent?: string;
}

const traces = new AsyncLocalStorage<Trace>();

/**
 * Run `fn` as part of one decision.
 *
 * Everything it awaits, and everything they await, answers this trace — including plugin code and
 * the host calls it makes back. Nesting is legal and the innermost wins, which is what a job that
 * opens a trace inside a request would want; nothing does that today.
 */
export const runInTrace = <T>(trace: Trace, fn: () => Promise<T>): Promise<T> => traces.run(trace, fn);

/** The decision currently being made, or `undefined` outside one. */
export const currentTrace = (): Trace | undefined => traces.getStore();

/** Its id alone, which is what a log line and a span both want. */
export const currentTraceId = (): string | undefined => traces.getStore()?.id;
