import type { ServerKitModule } from '@maroonedsoftware/koa';
import type { Container } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { errorText } from './error.text.js';

/**
 * Keep one module's teardown from costing every module after it theirs.
 *
 * ServerKit runs the shutdown hooks in reverse registration order, awaiting each one. Since
 * servercore 0.5 a hook that throws is logged and the rest still run, and `shutdownBudgetMs`
 * (set in `setup.server.ts`) puts one limit on the whole shutdown with a last-resort exit behind it.
 * What it does not do is bound a hook on its own: a hook that never settles is abandoned only when
 * the whole budget is spent, and every hook after it is then skipped. For this app that is the
 * transport loop, the audience poll, the config watch, the pools and, last of all, the log store.
 *
 * The bound here is per hook, so a hang costs its own module and nothing else. The budget is what
 * guarantees the exit; this is what keeps the teardowns that matter from being the price of it.
 *
 * Why the exit and the order both matter was measured on this install, before either existed: a
 * `SIGINT` logged `Shutting down Data` and then `Redis` and `Kysely` from inside that hook, and
 * nothing after it, ever: no later module, no `Server closed`. The process stayed up, kept
 * reconciling, and kept probing Liquidsoap with the bridge secret it had booted with, which by then
 * had been rotated. A day of restarts left enough of those behind to put 20 requests a second into an
 * endpoint whose p50 is 9ms, which starved the lease of the process that was actually meant to be
 * running and took the station off air.
 *
 * The defence is here rather than in each hook because the property wanted is about the LIST, not
 * about any one module: no hook may cost another one its teardown. Wrapping at the seam also covers a
 * module added later by someone who never reads this.
 *
 * A hook that overruns is abandoned, not cancelled. There is no way to cancel it, and its promise
 * stays pending until the exit kills the process. That is the right trade at this point in the
 * process's life: whatever it was holding is about to be released by the kernel anyway.
 */
/** The most one module's `shutdown` hook may take before the next one runs without it. */
export const SHUTDOWN_HOOK_BUDGET_MS = 5_000;

/** Wrap a module's `shutdown` so it cannot throw or hang past its budget. Returns it unchanged when it has none. */
export function withBoundedShutdown(module: ServerKitModule, budgetMs = SHUTDOWN_HOOK_BUDGET_MS): ServerKitModule {
    const hook = module.shutdown;
    if (!hook) return module;

    const label = module.name ?? 'a module';
    return {
        ...module,
        shutdown: async (container: Container) => {
            // Resolved rather than held: this runs once, at the end of the process's life, and a
            // logger captured at wrap time would be the one from before the container was built.
            const logger = loggerFor(container);
            const overran = Symbol('overran');
            const failed = Symbol('failed');
            const deadline = expire(budgetMs, overran);

            try {
                // The `catch` is on the hook's own promise as well as on the race, because an
                // abandoned hook that rejects LATER has nobody left awaiting it, and an unhandled
                // rejection during shutdown is a crash where a clean exit was one line away. It
                // answers its own token, not `overran`, or a hook that threw would also be reported
                // as one that ran out of time.
                const running = hook(container).catch((error: unknown) => {
                    logger?.warn(`shutdown: ${label} failed to tear down (${errorText(error)})`);
                    return failed;
                });

                if ((await Promise.race([running, deadline.promise])) === overran) {
                    logger?.warn(`shutdown: ${label} did not tear down within ${budgetMs}ms; carrying on without it`);
                }
            } finally {
                deadline.cancel();
            }
        },
    };
}

/**
 * The timer is `unref`ed so a budget nobody needs cannot be the thing holding the process open,
 * which would be this file causing what it exists to prevent.
 */
function expire(ms: number, token: symbol): { promise: Promise<symbol>; cancel: () => void } {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const promise = new Promise<symbol>(resolve => {
        timer = setTimeout(() => resolve(token), ms);
        timer.unref?.();
    });

    return { promise, cancel: () => clearTimeout(timer) };
}

/**
 * A logger, if there is still one to be had.
 *
 * `LoggingModule` deliberately tears down last precisely so there may not be, and a container that
 * cannot resolve one is a state this must survive rather than report: the whole point here is that
 * nothing in this file may become the reason a shutdown does not finish.
 */
function loggerFor(container: Container): Logger | undefined {
    try {
        return container.get(Logger);
    } catch {
        return undefined;
    }
}
