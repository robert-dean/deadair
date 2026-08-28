import { currentTraceId } from '#modules/shared/trace.context.js';

/**
 * How a job learns which decision enqueued it.
 *
 * ## Why the payload, of all places
 *
 * A job that enqueues another job is two decisions — separately scheduled, separately retried,
 * possibly minutes apart on different workers — so `AsyncLocalStorage` cannot carry the link: the
 * child runs on a context the parent's stack is long gone from. The only thing that travels between
 * them is the row in `pgboss.job`, and `JobBroker.send` takes a name, a payload and a `startAfter`.
 * There is no header, no metadata channel, and adding one would mean forking the broker.
 *
 * So it rides in the payload, under a key no job would choose. **The double underscore is the whole
 * convention**: it says "the queue put this here" to anybody reading `pgboss.job.data` by hand, and
 * it is why {@link takeParentTrace} can strip it without a job having to know it was ever there.
 *
 * ## What must not happen
 *
 * A job's `execute` must never see this. Payloads are typed per job, they are validated in places,
 * and a stray key on one is a field somebody eventually writes a branch on. The base classes take
 * it off before `execute` runs and there is no other reader — which is also why this is a pair of
 * functions rather than a shape anybody extends.
 *
 * **And a cron job must never carry one.** `schedule()` is called once at boot and the row it
 * writes fires forever; a parent stamped there would name a startup that happened weeks ago and
 * would be wrong on every run after the first. Only {@link withParentTrace} stamps, and only `send`
 * calls it.
 */

/** The key. Reserved, and readable as reserved in a `pgboss.job.data` column. */
export const PARENT_TRACE_KEY = '__trace';

/**
 * The payload as it should go on the wire: the caller's own, plus the decision doing the enqueueing.
 *
 * Outside a trace the payload is returned untouched rather than stamped with an empty value. Boot
 * scheduling and anything a plugin does on a timer of its own are roots, and a blank parent would
 * read as an edge to nowhere.
 */
export function withParentTrace<Payload extends object>(payload: Payload): Payload {
    const trace = currentTraceId();
    // `== null` rather than `=== undefined`, on the same rule the repositories follow: the value
    // reaching here is whatever a caller passed, the signature says `object`, and TypeScript does
    // not stop a `null` arriving from untyped code. See {@link takeParentTrace}, where it did.
    if (trace === undefined || payload == null || typeof payload !== 'object') return payload;

    // A caller's own key wins, which costs nothing today and means this can only ever add. It also
    // makes a re-enqueue of an already-stamped payload keep the ORIGINAL parent, which is the
    // honest answer: the decision that first asked for the work is the one that caused it.
    if (PARENT_TRACE_KEY in payload) return payload;

    return { ...payload, [PARENT_TRACE_KEY]: trace };
}

/**
 * Split an arriving payload into the parent it names and the payload the job actually asked for.
 *
 * Overloaded so that a required payload stays required: `TransactionalJob` takes one and hands it
 * to an `execute` that takes one, and a signature that widened it to `undefined` on the way through
 * would push a needless non-null assertion into the base class.
 *
 * @returns `payload` with the reserved key removed, and the parent id when there was one.
 */
export function takeParentTrace<Payload extends object>(payload: Payload): { payload: Payload; parent?: string };
export function takeParentTrace<Payload extends object>(payload: Payload | undefined): { payload: Payload | undefined; parent?: string };
export function takeParentTrace<Payload extends object>(payload: Payload | undefined): { payload: Payload | undefined; parent?: string } {
    // **`== null`, not `=== undefined`.** pg-boss delivers a cron job's absent payload as `null`,
    // the runner types it `Payload | undefined`, and `'__trace' in null` throws a `TypeError` — which
    // is exactly what it did, on the first boot after this was written, taking `ScheduleTickJob`
    // down with it before `execute` was ever reached. The signature is not evidence about the value:
    // this reads whatever the queue hands over, and the queue is not TypeScript.
    if (payload == null || typeof payload !== 'object' || !(PARENT_TRACE_KEY in payload)) return { payload };

    const { [PARENT_TRACE_KEY]: parent, ...rest } = payload as Payload & Record<string, unknown>;

    // A non-string is somebody else's key that happens to collide, and the honest thing is to drop
    // the link rather than to record a parent that is not an id. The key still comes off: a job
    // that did not put it there should not receive it either way.
    return { payload: rest as unknown as Payload, ...(typeof parent === 'string' ? { parent } : {}) };
}
