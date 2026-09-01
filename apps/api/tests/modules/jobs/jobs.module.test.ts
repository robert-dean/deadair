// The ready loop is fault-isolated: a hook that throws is logged and boot carries on. For the job
// runner that is the wrong side of fail-open, because everything on a schedule and every row the
// director enqueues goes through it, and a station without it is up in every way except the one
// that airs. What is pinned here is that the module refuses to let that state exist: a runner that
// cannot start asks for the same graceful close a SIGTERM does, with a failing exit code, and a
// start abandoned because shutdown had already begun is left alone.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Container } from 'injectkit';
import { JobRunner } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';

import { JobsModule } from '../../../src/modules/jobs/jobs.module.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

const containerWith = (runner: { start: () => Promise<void> }): Container =>
    ({
        get: (token: unknown) => {
            if (token === JobRunner) return runner;
            if (token === Logger) return logger;
            throw new Error(`unexpected token ${String(token)}`);
        },
    }) as unknown as Container;

const exitCodeBefore = process.exitCode;

afterEach(() => {
    process.exitCode = exitCodeBefore;
    vi.restoreAllMocks();
});

describe('JobsModule.ready', () => {
    it('starts the runner and touches nothing else when it comes up', async () => {
        const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
        const start = vi.fn(async () => {});

        await JobsModule.ready?.(containerWith({ start }), new AbortController().signal);

        expect(start).toHaveBeenCalledTimes(1);
        expect(kill).not.toHaveBeenCalled();
        expect(process.exitCode).toBe(exitCodeBefore);
    });

    it('stops the station, with a failing exit code, when the runner cannot start', async () => {
        const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
        const start = vi.fn(async () => {
            throw new Error('password authentication failed for user "deadair"');
        });

        await JobsModule.ready?.(containerWith({ start }), new AbortController().signal);

        // The same path a SIGTERM takes, so every module still tears down in order and the log
        // store flushes the reason; `process.exit` would have skipped both.
        expect(kill).toHaveBeenCalledWith(process.pid, 'SIGTERM');
        expect(process.exitCode).toBe(1);
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('failed to start'), {
            error: expect.stringContaining('password authentication failed'),
        });
    });

    it('does not start at all once shutdown has begun', async () => {
        const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
        const start = vi.fn(async () => {});
        const controller = new AbortController();
        controller.abort();

        await JobsModule.ready?.(containerWith({ start }), controller.signal);

        expect(start).not.toHaveBeenCalled();
        expect(kill).not.toHaveBeenCalled();
    });

    it('leaves a start that shutdown interrupted alone rather than reporting it as a failure', async () => {
        const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
        const controller = new AbortController();
        const start = vi.fn(async () => {
            controller.abort();
            throw new Error('aborted');
        });

        await JobsModule.ready?.(containerWith({ start }), controller.signal);

        expect(kill).not.toHaveBeenCalled();
        expect(process.exitCode).toBe(exitCodeBefore);
    });
});
