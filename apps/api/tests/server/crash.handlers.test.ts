// An unhandled rejection used to take the process down with nothing in the log naming it, because
// registering a handler for it suppresses Node's own exit. What is pinned here is that the same
// crash-and-restart policy holds — a failing exit code and a self-sent SIGTERM, the same shape
// `JobsModule`'s `ready` hook uses for a runner that cannot start — but a line naming the cause
// goes out first.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@maroonedsoftware/logger';

import { handleCrash, installCrashHandlers } from '../../src/server/crash.handlers.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

const exitCodeBefore = process.exitCode;

afterEach(() => {
    process.exitCode = exitCodeBefore;
    vi.restoreAllMocks();
});

describe('handleCrash', () => {
    it('names the cause, then stops the station with a failing exit code', () => {
        const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
        const error = new Error('connect ECONNREFUSED');

        handleCrash(logger, error);

        expect(logger.error).toHaveBeenCalledWith('api: an unhandled rejection; stopping the station', { error });
        expect(process.exitCode).toBe(1);
        // The same path a SIGTERM takes, so every module still tears down in order and the log
        // store flushes the reason; `process.exit` would have skipped both.
        expect(kill).toHaveBeenCalledWith(process.pid, 'SIGTERM');
    });

    it('names the cause even when the rejection value is not an Error', () => {
        const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
        const reason = 'rejected with a plain string';

        handleCrash(logger, reason);

        expect(logger.error).toHaveBeenCalledWith('api: an unhandled rejection; stopping the station', { error: reason });
        expect(process.exitCode).toBe(1);
        expect(kill).toHaveBeenCalledWith(process.pid, 'SIGTERM');
    });
});

describe('installCrashHandlers', () => {
    it('registers a handler for both unhandledRejection and uncaughtException', () => {
        const on = vi.spyOn(process, 'on').mockImplementation(() => process);

        installCrashHandlers(logger);

        expect(on).toHaveBeenCalledWith('unhandledRejection', expect.any(Function));
        expect(on).toHaveBeenCalledWith('uncaughtException', expect.any(Function));
        expect(on).toHaveBeenCalledTimes(2);
    });

    it('routes an unhandledRejection through to handleCrash', () => {
        const on = vi.spyOn(process, 'on').mockImplementation(() => process);
        const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);

        installCrashHandlers(logger);

        const rejectionHandler = on.mock.calls.find(call => call[0] === 'unhandledRejection')?.[1] as (error: unknown) => void;
        const error = new Error('boom');

        rejectionHandler(error);

        expect(logger.error).toHaveBeenCalledWith('api: an unhandled rejection; stopping the station', { error });
        expect(process.exitCode).toBe(1);
        expect(kill).toHaveBeenCalledWith(process.pid, 'SIGTERM');
    });

    it('routes an uncaughtException through to handleCrash', () => {
        const on = vi.spyOn(process, 'on').mockImplementation(() => process);
        const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);

        installCrashHandlers(logger);

        const exceptionHandler = on.mock.calls.find(call => call[0] === 'uncaughtException')?.[1] as (error: unknown) => void;
        const error = new Error('kaboom');

        exceptionHandler(error);

        expect(logger.error).toHaveBeenCalledWith('api: an unhandled rejection; stopping the station', { error });
        expect(process.exitCode).toBe(1);
        expect(kill).toHaveBeenCalledWith(process.pid, 'SIGTERM');
    });
});
