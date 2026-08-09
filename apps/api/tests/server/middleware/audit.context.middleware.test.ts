// This middleware owns the one transaction a request runs in, so it also owns the moment
// that transaction ends. `AfterCommit` is what a service registers follow-up work with
// when doing that work inline would mean reading its own uncommitted write from another
// pooled connection — a read that comes back stale, and a write that blocks on the lock
// the request is holding while the request waits for it. What is asserted here is the
// ordering that makes the seam worth anything: tasks run after the commit, never after a
// rollback, and against the pool rather than the transaction that has just ended.

import { Kysely } from 'kysely';
import { PgBossConnectionProvider } from '@maroonedsoftware/jobbroker/pgboss';
import { describe, expect, it, vi } from 'vitest';

import { auditContextMiddleware } from '../../../src/server/middleware/audit.context.middleware.js';
import { AfterCommit } from '../../../src/modules/data/after.commit.js';
import type { DB } from '../../../src/modules/data/db.js';

/** Enough of a Kysely executor for the `sql` template the middleware runs to compile and go nowhere. */
const executor = {
    executeQuery: async () => ({ rows: [] }),
    compileQuery: () => ({ sql: '', parameters: [], query: {} }),
    transformQuery: (node: unknown) => node,
    adapter: { supportsReturning: true },
    plugins: [],
    withPlugins: () => executor,
    withPluginAtFront: () => executor,
    withConnectionProvider: () => executor,
    withoutPlugins: () => executor,
};

const trx = { getExecutor: () => executor };

/**
 * A request as Koa presents it, with only what this middleware touches. The container
 * records every `override` so the test can see what the scope was pointing at when the
 * after-commit tasks ran, which is the part that would otherwise fail silently.
 */
function request(options: { rollback?: boolean; exempt?: boolean } = {}) {
    const afterCommit = new AfterCommit();
    const pooled = { id: 'root-provider' } as unknown as PgBossConnectionProvider;
    const db = {
        transaction: () => ({
            execute: async (work: (t: unknown) => Promise<void>) => {
                await work(trx);
                if (options.rollback) throw new Error('the handler failed');
            },
        }),
    } as unknown as Kysely<DB>;

    const overrides: [unknown, unknown][] = [];
    const container = {
        get: (token: unknown) => {
            if (token === AfterCommit) return afterCommit;
            if (token === PgBossConnectionProvider) return pooled;
            return db;
        },
        override: (token: unknown, value: unknown) => overrides.push([token, value]),
    };

    return {
        ctx: {
            method: 'PUT',
            path: options.exempt ? '/healthcheck' : '/plugins/deadair.spotify/config',
            requestId: 'req-1',
            ipAddress: '127.0.0.1',
            container,
        },
        afterCommit,
        overrides,
        db,
        pooled,
    };
}

const run = async (harness: ReturnType<typeof request>, handler: () => Promise<void> = async () => {}) =>
    auditContextMiddleware()(harness.ctx as never, handler);

describe('auditContextMiddleware after-commit work', () => {
    it('runs a registered task once the transaction has committed', async () => {
        const harness = request();
        const task = vi.fn(async () => {});

        await run(harness, async () => {
            harness.afterCommit.add(task);
            // Still inside the transaction: this is the window where doing the work
            // inline reads the pre-write row and then blocks on it.
            expect(task).not.toHaveBeenCalled();
        });

        expect(task).toHaveBeenCalledTimes(1);
    });

    // The whole reason the work is registered rather than done inline: a request that
    // fails writes nothing, so its follow-up must not happen either.
    it('does not run a task when the handler threw and the transaction rolled back', async () => {
        const harness = request({ rollback: true });
        const task = vi.fn(async () => {});

        await expect(run(harness, async () => harness.afterCommit.add(task))).rejects.toThrow('the handler failed');

        expect(task).not.toHaveBeenCalled();
    });

    // The scope's `Kysely` is the transaction object right up to the commit, and a task
    // resolving one from the request's own container would otherwise get
    // `Transaction is already committed` — the very error this seam exists to stop.
    it('points the scope back at the pool before the tasks run', async () => {
        const harness = request();
        let sawOverrides: [unknown, unknown][] = [];

        await run(harness, async () => harness.afterCommit.add(async () => void (sawOverrides = [...harness.overrides])));

        expect(sawOverrides.at(-2)).toEqual([Kysely, harness.db]);
        expect(sawOverrides.at(-1)).toEqual([PgBossConnectionProvider, harness.pooled]);
    });

    // An exempt route has no transaction to wait for, so "after the commit" is
    // immediately after the handler. Running them here too is what keeps `add` from
    // quietly meaning "never" on a route somebody later exempts.
    it('still runs tasks on a route that is exempt from the transaction', async () => {
        const harness = request({ exempt: true });
        const task = vi.fn(async () => {});

        await run(harness, async () => harness.afterCommit.add(task));

        expect(task).toHaveBeenCalledTimes(1);
    });
});
