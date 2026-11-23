// The ready loop is fault-isolated: a hook that throws is logged and boot carries on. For the job
// runner that is the wrong side of fail-open, because everything on a schedule and every row the
// director enqueues goes through it, and a station without it is up in every way except the one
// that airs. What is pinned here is that the module refuses to let that state exist: it declares
// `readyRequired`, so ServerKit closes the server with a failing exit code when the hook throws, and
// the hook throws for a runner that cannot start but not for a start abandoned because shutdown had
// already begun, which would turn an ordinary stop into a failure.

import { describe, expect, it, vi } from 'vitest';
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

describe('JobsModule.ready', () => {
    it('is required, so a failure closes the server rather than being logged and passed over', () => {
        expect(JobsModule.readyRequired).toBe(true);
    });

    it('starts the runner when it comes up', async () => {
        const start = vi.fn(async () => {});

        await expect(JobsModule.ready?.(containerWith({ start }), new AbortController().signal)).resolves.toBeUndefined();

        expect(start).toHaveBeenCalledTimes(1);
    });

    it('fails, naming the cause, when the runner cannot start', async () => {
        const cause = new Error('password authentication failed for user "deadair"');
        const start = vi.fn(async () => {
            throw cause;
        });

        const failed = JobsModule.ready?.(containerWith({ start }), new AbortController().signal);

        // The message is the line ServerKit logs as it closes the server, so it carries the cause
        // as text as well as on `cause`.
        await expect(failed).rejects.toThrow(/runner failed to start.*password authentication failed/);
        await expect(failed).rejects.toMatchObject({ cause });
    });

    it('does not start at all once shutdown has begun', async () => {
        const start = vi.fn(async () => {});
        const controller = new AbortController();
        controller.abort();

        await expect(JobsModule.ready?.(containerWith({ start }), controller.signal)).resolves.toBeUndefined();

        expect(start).not.toHaveBeenCalled();
    });

    it('leaves a start that shutdown interrupted alone rather than reporting it as a failure', async () => {
        const controller = new AbortController();
        const start = vi.fn(async () => {
            controller.abort();
            throw new Error('aborted');
        });

        await expect(JobsModule.ready?.(containerWith({ start }), controller.signal)).resolves.toBeUndefined();
    });
});
