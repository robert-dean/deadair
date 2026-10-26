// `station_air` is whether the station is driving and why it stopped, and the live mark is the one
// part of that a hand-back acts on. What is pinned is what each statement writes: a live stand-down
// marks the row, any other stand-down clears it, and going on air clears it.

import { Kysely, PostgresDialect, DummyDriver } from 'kysely';
import type { DatabaseConnection, Dialect, Driver, QueryResult } from 'kysely';
import { KyselyDefaultPlugins } from '@maroonedsoftware/kysely';
import { describe, expect, it } from 'vitest';

import { StationAirRepository } from '../../../src/modules/director/station.air.repository.js';
import type { DB } from '../../../src/modules/data/db.js';

interface Captured {
    sql: string;
    parameters: readonly unknown[];
}

function fakeDb(captured: Captured[]): Kysely<DB> {
    const postgres = new PostgresDialect({ pool: {} as never });
    const connection: DatabaseConnection = {
        executeQuery: async compiled => {
            captured.push({ sql: compiled.sql, parameters: compiled.parameters });
            return { rows: [], numAffectedRows: 0n } as QueryResult<never>;
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

describe('StationAirRepository and the live mark', () => {
    it('marks a stand-down a live show made', async () => {
        const captured: Captured[] = [];
        await new StationAirRepository(fakeDb(captured)).standDown('main', false, true);

        expect(captured[0]!.sql).toContain('"stood_down_for_live" = $');
        expect(captured[0]!.parameters).toEqual([false, false, true, 'main']);
    });

    it('clears it on any other stand-down, so a Stop during a show is not overruled when it ends', async () => {
        const captured: Captured[] = [];
        await new StationAirRepository(fakeDb(captured)).standDown('main');

        expect(captured[0]!.parameters).toEqual([false, false, false, 'main']);
    });

    it('clears it on going on air', async () => {
        const captured: Captured[] = [];
        await new StationAirRepository(fakeDb(captured)).goOnAir();

        expect(captured[0]!.sql).toMatch(/do update set .*"stood_down_for_live" = \$\d/);
        expect(captured[0]!.parameters).toContain(false);
    });
});
