import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The deadline of the call into plugin code that is currently running, and the
 * signal that fires when it passes.
 *
 * `PluginInvoker` decides how long any one call gets, per call: it takes a
 * `timeoutMs` and falls back to `PLUGIN_INVOKE_TIMEOUT_MS`. Everything the
 * plugin does inside that call is spending the same clock, and the host
 * services the plugin reaches back into (`host.fetch` today) have to size their
 * own budgets against what is actually left rather than against the default
 * constant. A fetch that grants 15s inside a 5s invocation is killed mid-flight
 * with nothing useful to say; one capped at 15s inside a 60s background job
 * refuses time the plugin genuinely has.
 *
 * Ambient rather than threaded through every signature because the value has to
 * survive arbitrary plugin code in the middle: the host calls a plugin method,
 * the plugin does whatever it likes, and eventually calls back into the host.
 * There is no parameter that could carry the deadline across that gap.
 *
 * Module-level rather than `@Injectable` for the same reason `RotatingLogStore`
 * is: it must be one store for the whole process (a second instance would be a
 * second, empty context), and it holds no configuration to inject.
 */
interface PluginInvocation {
    /** Epoch ms at which `PluginInvoker` abandons the call. */
    deadlineAt: number;

    /**
     * Aborts when the invoker gives up on the call.
     *
     * The invoker has always built this and raced against it; what is new is
     * that plugin code may now have it. It is the same controller, not a copy,
     * so a plugin that honours it and the invoker that abandons the call agree
     * by construction rather than by both watching a clock.
     */
    signal: AbortSignal;
}

const invocations = new AsyncLocalStorage<PluginInvocation>();

/**
 * A signal for code running outside any invocation.
 *
 * Never aborts, because nothing is waiting: a plugin holding its host and
 * calling it from a timer of its own is a real state rather than an error, and
 * an already-aborted signal would refuse work that is legitimately unbounded.
 * One instance for the process, since it carries no state and listeners on it
 * are never called.
 */
const NEVER_ABORTS: AbortSignal = new AbortController().signal;

/** Runs `fn` as the invocation that ends at `deadlineAt` and aborts `signal`. */
export const runWithDeadline = <T>(deadlineAt: number, signal: AbortSignal, fn: () => Promise<T>): Promise<T> =>
    invocations.run({ deadlineAt, signal }, fn);

/**
 * Milliseconds left in the running invocation, or `undefined` when there is
 * none.
 *
 * No invocation is a real state, not an error: a plugin may hold its host and
 * call it from a timer it set itself, which no host call is waiting on. The
 * caller decides what to do about it, and the honest answer is to fall back to
 * the ordinary per-call default. Can be negative, for a caller that wants to
 * distinguish "expired" from "expiring".
 */
export const invocationRemainingMs = (): number | undefined => {
    const invocation = invocations.getStore();
    return invocation === undefined ? undefined : invocation.deadlineAt - Date.now();
};

/** The running invocation's signal, or one that never aborts when there is none. */
export const invocationSignal = (): AbortSignal => invocations.getStore()?.signal ?? NEVER_ABORTS;
