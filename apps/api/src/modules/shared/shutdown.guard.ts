import type { ServerKitModule } from '@maroonedsoftware/koa';
import type { Container } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { errorText } from './error.text.js';

/**
 * Keep one module's teardown from stranding every module after it.
 *
 * ServerKit runs the shutdown hooks in registration order, awaiting each one, and — unlike the
 * `ready` loop directly above it in the same file, which wraps every hook in a `try` — it catches
 * nothing and bounds nothing:
 *
 * ```js
 * for (const module of this.modules) {
 *     if (module.shutdown) { … await module.shutdown(this.container); }
 * }
 * this.logger.info('Server closed');
 * process.exit();
 * ```
 *
 * So a hook that throws or never settles takes three things with it. Every later module's hook
 * never runs, which for this app means the transport loop, the audience poll and the config watch
 * are never stopped. `process.exit()` is never reached. And those loops keep the process ALIVE and
 * still working: they are `unref`ed, which stops them holding the event loop open by themselves but
 * does not stop them firing while something else does.
 *
 * That is not a theory. Measured on this install: a `SIGINT` logged `Shutting down Data` and then
 * `Redis` and `Kysely` from inside that hook, and nothing after it, ever — no later module, no
 * `Server closed`. The process stayed up, kept reconciling, and kept probing Liquidsoap with the
 * bridge secret it had booted with, which by then had been rotated. A day of restarts left enough
 * of those behind to put 20 requests a second into an endpoint whose p50 is 9ms, which starved the
 * lease of the process that was actually meant to be running and took the station off air.
 *
 * The station's own defence is here rather than in each hook because the property wanted is about
 * the LIST, not about any one module: no hook may cost another one its teardown. Wrapping at the
 * seam also covers a module added later by someone who never reads this.
 *
 * A hook that overruns is abandoned, not cancelled — there is no way to cancel it, and its promise
 * stays pending until the exit below kills the process. That is the right trade at this point in
 * the process's life: whatever it was holding is about to be released by the kernel anyway, and the
 * alternative on the evidence above is a process that never dies at all.
 */
export const SHUTDOWN_BUDGET_MS = 5_000;

/** Wrap a module's `shutdown` so it cannot throw or hang past its budget. Returns it unchanged when it has none. */
export function withBoundedShutdown(module: ServerKitModule, budgetMs = SHUTDOWN_BUDGET_MS): ServerKitModule {
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
            const deadline = expire(budgetMs, overran);

            try {
                // The `catch` is on the hook's own promise as well as on the race, because an
                // abandoned hook that rejects LATER has nobody left awaiting it, and an unhandled
                // rejection during shutdown is a crash where a clean exit was one line away.
                const running = hook(container).catch((error: unknown) => {
                    logger?.warn(`shutdown: ${label} failed to tear down (${errorText(error)})`);
                    return overran;
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
 * `LoggingModule` is deliberately last precisely so it is not, and a container that cannot resolve
 * one is a state this must survive rather than report: the whole point here is that nothing in this
 * file may become the reason a shutdown does not finish.
 */
function loggerFor(container: Container): Logger | undefined {
    try {
        return container.get(Logger);
    } catch {
        return undefined;
    }
}
