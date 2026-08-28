// Both job base classes open the trace every log line and every span downstream is filed under, so
// the thing worth testing is that `execute` can actually read one — and that the id is the job's own
// rather than something invented, since the whole design rests on the trace id already being the
// correlation id the audit trail uses.
//
// The two classes are asserted separately on purpose. They open the trace at different points for
// different reasons: `PlainJob` after the actor override, `TransactionalJob` outside its transaction
// so a failure to open one is still part of the decision. Those are two behaviours that happen to
// agree about the id, not one behaviour written twice.

import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { Container } from 'injectkit';
import { Kysely } from 'kysely';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { PgBossConnectionProvider } from '@maroonedsoftware/jobbroker/pgboss';
import type { Logger } from '@maroonedsoftware/logger';

import { PlainJob } from '../../../src/modules/jobs/plain.job.js';
import { TransactionalJob } from '../../../src/modules/jobs/transactional.job.js';
import { AuthorizationContext } from '../../../src/modules/permissions/authorization.context.js';
import { currentTrace } from '../../../src/modules/shared/trace.context.js';

const stubLogger = (): Logger => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() });

const context = { id: 'job-42', name: 'director.refill_lineup' } as unknown as JobContext;

/** A scope that answers the three tokens the bases resolve, and records nothing else. */
function fakeScope(overrides: Record<string, unknown> = {}) {
    const executor = {
        transformQuery: (node: unknown) => node,
        compileQuery: () => ({ sql: '', parameters: [], query: {} }),
        executeQuery: vi.fn(async () => ({ rows: [] })),
        withPlugins: () => executor,
    };
    const trx = { getExecutor: () => executor };
    const db = { transaction: () => ({ execute: async (fn: (t: unknown) => Promise<void>) => fn(trx) }) };

    return {
        get: vi.fn((token: unknown) => {
            if (token === Kysely) return db;
            if (token === JobContext) return context;
            return overrides[String(token)];
        }),
        override: vi.fn(),
    } as unknown as Container;
}

describe('the trace a job opens', () => {
    it('is readable from inside a plain job, under the job id', async () => {
        let seen: ReturnType<typeof currentTrace>;
        class Probe extends PlainJob {
            protected async execute(): Promise<void> {
                seen = currentTrace();
            }
        }

        await new Probe(context, fakeScope(), stubLogger()).run();

        // The id is `JobContext.id` and the kind is the queue name — the same two values
        // `overrideJobActor` and the `app.request_id` GUC are built from. Nothing is generated.
        expect(seen).toEqual({ id: 'job-42', kind: 'director.refill_lineup' });
    });

    it('is readable from inside a transactional job, under the same job id', async () => {
        let seen: ReturnType<typeof currentTrace>;
        class Probe extends TransactionalJob {
            protected async execute(): Promise<void> {
                seen = currentTrace();
            }
        }

        await new Probe(fakeScope({ [String(PgBossConnectionProvider)]: {}, [String(AuthorizationContext)]: {} })).run({});

        expect(seen).toEqual({ id: 'job-42', kind: 'director.refill_lineup' });
    });

    it('closes when the job body throws, rather than leaking into the next execution', async () => {
        // The runner reuses this thread for whatever dequeues next. A trace that outlived a failed
        // job would file the following one's lines under it, which is worse than no trace at all:
        // a wrong answer is not obviously wrong where a missing one is.
        class Boom extends PlainJob {
            protected async execute(): Promise<void> {
                throw new Error('the model host is down');
            }
        }

        await expect(new Boom(context, fakeScope(), stubLogger()).run()).rejects.toThrow('the model host is down');
        expect(currentTrace()).toBeUndefined();
    });
});
