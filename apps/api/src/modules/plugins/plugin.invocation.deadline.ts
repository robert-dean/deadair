import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The deadline of the call into plugin code that is currently running.
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
 * second, empty context), and it holds no configuration to inject. The
 * subprocess isolation target does not need it at all, since a deadline then
 * rides in the IPC call frame where it belongs.
 */
interface PluginInvocation {
    /** Epoch ms at which `PluginInvoker` abandons the call. */
    deadlineAt: number;
}

const invocations = new AsyncLocalStorage<PluginInvocation>();

/** Runs `fn` as the invocation that ends at `deadlineAt`. */
export const runWithDeadline = <T>(deadlineAt: number, fn: () => Promise<T>): Promise<T> => invocations.run({ deadlineAt }, fn);

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
