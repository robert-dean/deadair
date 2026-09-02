import type { Logger } from '@maroonedsoftware/logger';

/**
 * Names the cause before the process stops.
 *
 * Node suppresses its own exit once a handler is registered for `unhandledRejection` or
 * `uncaughtException`, so without the explicit `SIGTERM` the process would survive a rejection
 * that used to take it down — a behaviour change nobody asked for. The `SIGTERM` keeps
 * crash-and-restart as the policy, with a line naming the cause going out first, the same shape
 * `JobsModule`'s `ready` hook uses for a runner that cannot start
 * (`apps/api/src/modules/jobs/jobs.module.ts`).
 */
export function installCrashHandlers(logger: Logger): void {
    process.on('unhandledRejection', error => handleCrash(logger, error));
    process.on('uncaughtException', error => handleCrash(logger, error));
}

/**
 * The handler itself, exported separately so a test can call it directly rather than emitting
 * `unhandledRejection`/`uncaughtException` on the real `process` under vitest.
 */
export function handleCrash(logger: Logger, error: unknown): void {
    logger.error('api: an unhandled rejection; stopping the station', { error });
    process.exitCode = 1;
    process.kill(process.pid, 'SIGTERM');
}
