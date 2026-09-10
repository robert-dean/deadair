// The rest of this repository is covered end to end by `pick.resolver.test.ts`, which fakes
// `CandidatesRepository` outright. What is worth pinning HERE, against a real (dummy-driven)
// compile, is that the SQL `sample` and `ratingsFor` actually send carries the credited-artist veto
// (`noCreditedDislike`/`creditedDislikeExists` are shared with `tracks.repository.ts`), and a typo
// in either query's use of them would compile, run, and simply never veto anything.

import { Kysely, PostgresDialect, DummyDriver } from 'kysely';
import type { DatabaseConnection, Dialect, Driver, QueryResult } from 'kysely';
import { KyselyDefaultPlugins } from '@maroonedsoftware/kysely';
import { describe, expect, it } from 'vitest';

import { CandidatesRepository } from '../../../src/modules/director/candidates.repository.js';
import type { DB } from '../../../src/modules/data/db.js';

interface Captured {
    statements: { sql: string; parameters: readonly unknown[] }[];
}

/** A database that compiles the statement for real and answers with no rows, since only the SQL matters here. */
function fakeDb(captured: Captured = { statements: [] }): Kysely<DB> {
    const postgres = new PostgresDialect({ pool: {} as never });

    const connection: DatabaseConnection = {
        executeQuery: async compiled => {
            captured.statements.push({ sql: compiled.sql, parameters: compiled.parameters });
            return { rows: [] } as QueryResult<never>;
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

describe('CandidatesRepository.sample', () => {
    it('carries the credited-artist veto beside its three rating filters', async () => {
        const captured: Captured = { statements: [] };
        await new CandidatesRepository(fakeDb(captured)).sample(10);

        const [statement] = captured.statements;
        expect(statement?.sql).toContain('track_artists');
        expect(statement?.sql).toContain('not exists');
        // The join that resolves a guest's identity, not the lead's.
        expect(statement?.sql).toContain('"ca"."rating"');
    });
});

describe('CandidatesRepository.ratingsFor', () => {
    it('folds the same credited-artist veto into the effective rating it computes', async () => {
        const captured: Captured = { statements: [] };
        await new CandidatesRepository(fakeDb(captured)).ratingsFor(['track-1']);

        const [statement] = captured.statements;
        // Raw form here, not `noCreditedDislike`'s Kysely `not exists`: `effectiveRating` folds
        // the POSITIVE `exists` into `least()` instead of filtering rows out.
        expect(statement?.sql).toContain('track_artists');
        expect(statement?.sql).toContain('exists');
        expect(statement?.sql).toContain('least');
    });
});
