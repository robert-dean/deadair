// The walk's queue is one query, and the defect this pins was a state that query never named: a
// measurement the analyzer marked incomplete is a SUCCESSFUL row (`analyzed_at` set, `failed_at`
// null), so neither the stale-schema branch nor the failure branch picked it up, and since the
// trusted read ignores it too, the record aired forever with no levelling and no cue points. Only
// the SQL matters here, so it is compiled for real against a dummy driver and inspected.

import { Kysely, PostgresDialect, DummyDriver } from 'kysely';
import type { DatabaseConnection, Dialect, Driver, QueryResult } from 'kysely';
import { KyselyDefaultPlugins } from '@maroonedsoftware/kysely';
import { describe, expect, it, vi } from 'vitest';

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
        expect(sql).toContain('src.is_local desc, t.created_at asc');
    });
});

describe('AnalysisRepository.trackNeedingAnalysisFor', () => {
    async function oneStatement(rows: unknown[] = []) {
        const captured: Captured = { statements: [] };
        const track = await new AnalysisRepository(fakeDb(captured, rows)).trackNeedingAnalysisFor('source-9', 1);
        const [statement] = captured.statements;
        if (statement === undefined) throw new Error('the lookup sent no statement');
        return { track, sql: statement.sql.replace(/\s+/g, ' '), parameters: statement.parameters };
    }

    // The point of sharing the statement: the per-track job is due exactly when the walk would be.
    it("asks the walk's own question, held to the track behind the binding", async () => {
        const { sql, parameters } = await oneStatement();
        const walk = await walkStatement();

        expect(sql).toMatch(/and t\.id = \(select own\.track_id from deadair\.track_sources own where own\.id = \$1\)/);
        expect(parameters[0]).toBe('source-9');
        expect(sql.replace(/and t\.id = \(select own\.track_id from deadair\.track_sources own where own\.id = \$1\) /, '')).toBe(
            walk.sql.replace(/\$(\d+)/g, (_, n: string) => `$${Number(n) + 1}`),
        );
    });

    it('answers nothing when the track is not due, which is a measured one', async () => {
        const { track } = await oneStatement([]);

        expect(track).toBeUndefined();
    });

    it('answers the track and the binding the walk would measure', async () => {
        const { track } = await oneStatement([
            { trackId: 'track-9', title: 'A Record', artistName: 'An Artist', pluginId: 'deadair.navidrome', externalId: 'nd-9', durationMs: 200_000 },
        ]);

        expect(track).toEqual({
            trackId: 'track-9',
            title: 'A Record',
            artistName: 'An Artist',
            pluginId: 'deadair.navidrome',
            externalId: 'nd-9',
            durationMs: 200_000,
        });
    });
});

describe('a re-measure', () => {
    it('leaves a stale row out of the queue for a day after a failed try', async () => {
        const { sql, parameters } = await walkStatement();

        expect(sql).toMatch(/a\.schema_version < \$\d+ and \(a\.remeasure_failed_at is null or a\.remeasure_failed_at < now\(\) - make_interval/);
        expect(parameters).toContain(ANALYSIS_RETRY_AFTER_MS / 1000);
    });

    it('puts a record with no whole measurement ahead of every record that has one', async () => {
        const { sql } = await walkStatement();

        expect(sql).toContain('order by coalesce(a.analyzed_at is not null and a.complete, false) asc, src.is_local desc');
    });

    /** Statements sent, with the update answering as a row that does or does not hold a whole measurement. */
    async function writing(holdsWhole: boolean, write: (repository: AnalysisRepository) => Promise<void>): Promise<string[]> {
        const captured: Captured = { statements: [] };
        const db = fakeDb(captured);
        const repository = new AnalysisRepository(db);
        vi.spyOn(db.getExecutor(), 'executeQuery').mockImplementation(async compiled => {
            captured.statements.push({ sql: compiled.sql, parameters: compiled.parameters });
            const updating = compiled.sql.startsWith('update');
            return { rows: [], numAffectedRows: updating && holdsWhole ? 1n : 0n } as never;
        });
        await write(repository);
        return captured.statements.map(statement => statement.sql.split(' ').slice(0, 2).join(' '));
    }

    const whole = { schemaVersion: 2, complete: true, data: { cueIn: 0, introEnd: 1, outroStart: 2, cueOut: 3 } };

    it('keeps a whole measurement when a failure comes back', async () => {
        const sent = await writing(true, repository => repository.recordFailure('t', 'p', 'the fetch failed', 'unfetchable'));

        expect(sent).toEqual(['update "deadair"."track_analysis"']);
    });

    it('keeps a whole measurement when only part of the file comes back', async () => {
        const sent = await writing(true, repository => repository.recordAnalysis('t', 'p', { ...whole, complete: false }));

        expect(sent).toEqual(['update "deadair"."track_analysis"']);
    });

    it('records the failure of a record with nothing to keep', async () => {
        const sent = await writing(false, repository => repository.recordFailure('t', 'p', 'the fetch failed', 'unfetchable'));

        expect(sent).toEqual(['update "deadair"."track_analysis"', 'insert into']);
    });

    it('writes a whole answer without asking', async () => {
        const sent = await writing(true, repository => repository.recordAnalysis('t', 'p', whole));

        expect(sent).toEqual(['insert into']);
    });
});

describe('AnalysisRepository.stateFor', () => {
    const stateFor = (row: Record<string, unknown>) => new AnalysisRepository(fakeDb({ statements: [] }, [row])).stateFor('t-1');

    it('carries the tempo where the row has one, and leaves it out where it has not', async () => {
        const measured = await stateFor({ schemaVersion: 1, complete: true, analyzedAt: new Date(), bpm: 117.1, beatConfidence: 0.99 });
        const older = await stateFor({ schemaVersion: 1, complete: true, analyzedAt: new Date(), bpm: null, beatConfidence: null });

        expect(measured).toMatchObject({ bpm: 117.1, beatConfidence: 0.99 });
        expect(older).not.toHaveProperty('bpm');
        expect(older).not.toHaveProperty('beatConfidence');
    });

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
