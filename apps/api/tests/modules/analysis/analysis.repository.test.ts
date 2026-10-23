// The walk's queue is one query, and the defect this pins was a state that query never named: a
// measurement the analyzer marked incomplete is a SUCCESSFUL row (`analyzed_at` set, `failed_at`
// null), so neither the stale-schema branch nor the failure branch picked it up, and since the
// trusted read ignores it too, the record aired forever with no levelling and no cue points. Only
// the SQL matters here, so it is compiled for real against a dummy driver and inspected.

import { Kysely, PostgresDialect, DummyDriver } from 'kysely';
import type { DatabaseConnection, Dialect, Driver, QueryResult } from 'kysely';
import { KyselyDefaultPlugins } from '@maroonedsoftware/kysely';
import { describe, expect, it } from 'vitest';

import { ANALYSIS_REFETCH_AFTER_MS, ANALYSIS_RETRY_AFTER_MS, AnalysisRepository } from '../../../src/modules/analysis/analysis.repository.js';
import type { DB } from '../../../src/modules/data/db.js';

interface Captured {
    statements: { sql: string; parameters: readonly unknown[] }[];
}

/** A database that compiles the statement for real and answers with no rows, since only the SQL matters here. */
function fakeDb(captured: Captured, rows: unknown[] = []): Kysely<DB> {
    const postgres = new PostgresDialect({ pool: {} as never });

    const connection: DatabaseConnection = {
        executeQuery: async compiled => {
            captured.statements.push({ sql: compiled.sql, parameters: compiled.parameters });
            return { rows } as QueryResult<never>;
        },
        streamQuery: () => {
            throw new Error('nothing here streams');
        },
    };

    const driver: Driver = Object.assign(new DummyDriver(), { acquireConnection: async () => connection });

    const dialect: Dialect = {
        createAdapter: () => postgres.createAdapter(),
        createIntrospector: db => postgres.createIntrospector(db),
        createQueryCompiler: () => postgres.createQueryCompiler(),
        createDriver: () => driver,
    };

    return new Kysely<DB>({ dialect, plugins: [...KyselyDefaultPlugins] });
}

/** The walk's statement with its whitespace folded, so an assertion is about the SQL rather than its layout. */
async function walkStatement(): Promise<{ sql: string; parameters: readonly unknown[] }> {
    const captured: Captured = { statements: [] };
    await new AnalysisRepository(fakeDb(captured)).listTracksNeedingAnalysis(1, 50);

    const [statement] = captured.statements;
    if (statement === undefined) throw new Error('the walk sent no statement');
    return { sql: statement.sql.replace(/\s+/g, ' '), parameters: statement.parameters };
}

describe('AnalysisRepository.listTracksNeedingAnalysis', () => {
    it('queues a measurement of part of a file, not only a failure', async () => {
        const { sql } = await walkStatement();

        expect(sql).toContain('a.analyzed_at is not null and not a.complete');
    });

    it('waits at least the refetch interval before measuring an incomplete row again', async () => {
        const { sql, parameters } = await walkStatement();

        // The floor is the same hour a `truncated` failure waits, which is usually the same cut transfer.
        expect(sql).toMatch(/not a\.complete and a\.analyzed_at < now\(\) - least\(greatest\(make_interval\(secs => \$\d+::double precision\)/);
        expect(parameters).toContain(ANALYSIS_REFETCH_AFTER_MS / 1000);
    });

    it('doubles the wait from the row age and caps it at the long retry, so a short-forever record is bounded', async () => {
        const { sql, parameters } = await walkStatement();

        // Doubling: each retry waits as long as the row has existed, since the table keeps no attempt count.
        expect(sql).toContain('a.analyzed_at - a.created_at');
        // Capped at the day an undecodable file waits, so a provider whose length claim is permanently
        // wrong costs one attempt a day rather than one an hour, and an old row's first retry is not months away.
        expect(sql).toMatch(/a\.analyzed_at - a\.created_at\), make_interval\(secs => \$\d+::double precision\)\)\)/);
        expect(parameters).toContain(ANALYSIS_RETRY_AFTER_MS / 1000);
    });

    it('keeps the stale-schema and failure branches, and the local-first order', async () => {
        const { sql } = await walkStatement();

        expect(sql).toContain('a.track_id is null');
        expect(sql).toContain('a.schema_version <');
        expect(sql).toContain("a.failure_code in ('unfetchable', 'truncated')");
        expect(sql).toContain('order by src.is_local desc, t.created_at asc');
    });
});

describe('AnalysisRepository.stateFor', () => {
    const stateFor = (row: Record<string, unknown>) => new AnalysisRepository(fakeDb({ statements: [] }, [row])).stateFor('t-1');

    it('reports the kind of a failure the walk stored', async () => {
        const state = await stateFor({ schemaVersion: 1, complete: false, failedAt: '2026-10-23T03:12:00Z', failureCode: 'unfetchable' });

        expect(state).toMatchObject({ failureCode: 'unfetchable' });
    });

    it('reads a failure stored before the kind was kept as undecodable, the clock it is retried on', async () => {
        const state = await stateFor({ schemaVersion: 1, complete: false, failedAt: '2026-10-23T03:12:00Z', failureCode: undefined });

        expect(state).toMatchObject({ failureCode: 'undecodable' });
    });

    it('carries no kind at all for a measurement that worked', async () => {
        const state = await stateFor({ schemaVersion: 1, complete: true, analyzedAt: '2026-10-23T03:12:00Z', failureCode: undefined });

        expect(state).not.toHaveProperty('failureCode');
    });
});
