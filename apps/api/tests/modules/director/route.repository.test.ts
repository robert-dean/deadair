// SQL shape only, against a dummy-driven compile: which artists a route may stop at, and the shared
// credits that are the one factual link between two of them.

import { Kysely, PostgresDialect, DummyDriver } from 'kysely';
import type { DatabaseConnection, Dialect, Driver, QueryResult } from 'kysely';
import { KyselyDefaultPlugins } from '@maroonedsoftware/kysely';
import { describe, expect, it } from 'vitest';

import { RouteRepository } from '../../../src/modules/director/route.repository.js';
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

describe('RouteRepository.ownedArtists', () => {
    it('counts an artist only as the lead of a live, unrefused record with a copy that is not missing', async () => {
        const captured: Captured = { statements: [] };
        await new RouteRepository(fakeDb(captured)).ownedArtists(['portishead', 'portishead', '']);

        const statement = captured.statements[0];
        expect(statement?.sql).toContain('"deadair"."tracks"."artist_id" = "deadair"."artists"."id"');
        expect(statement?.sql).toContain('"deadair"."track_sources"."missing_at" is null');
        expect(statement?.sql).toContain('"deadair"."artists"."rating" <> $');
        expect(statement?.parameters.filter(parameter => parameter === 'portishead')).toHaveLength(1);
    });

    it('asks nothing about nobody', async () => {
        const captured: Captured = { statements: [] };
        expect(await new RouteRepository(fakeDb(captured)).ownedArtists([])).toEqual(new Map());
        expect(captured.statements).toHaveLength(0);
    });
});

describe('RouteRepository.coCredits', () => {
    it('pairs two credits on one record, never an artist with themself, one record per partner', async () => {
        const captured: Captured = { statements: [] };
        await new RouteRepository(fakeDb(captured)).coCredits('gorillaz');

        const sql = captured.statements[0]?.sql ?? '';
        expect(sql).toContain('"theirs"."artist_id" <> "mine"."artist_id"');
        expect(sql).toContain('distinct on ("partner"."artist_key")');
    });
});
