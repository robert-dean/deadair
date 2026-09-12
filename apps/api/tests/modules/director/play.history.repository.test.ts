// The history is what every rotation rule steers by, and the rules that read it have no symptom
// when they are wrong except a station that repeats itself. So what is pinned here is the SQL each
// read compiles to, on a database that compiles for real and answers with rows the test chose: that
// a read is scoped to the station, keyed on the song rather than the catalog row, and that a
// switched-off rule costs no query at all.

import { Kysely, PostgresDialect, DummyDriver } from 'kysely';
import type { DatabaseConnection, Dialect, Driver, QueryResult } from 'kysely';
import { KyselyDefaultPlugins } from '@maroonedsoftware/kysely';
import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';

import { PlayHistoryRepository } from '../../../src/modules/director/play.history.repository.js';
import type { DB } from '../../../src/modules/data/db.js';

interface Captured {
    queries: { sql: string; parameters: readonly unknown[] }[];
}

/** A database that compiles the statement for real, records it, and answers with rows somebody chose. */
function fakeDb(rows: unknown[], captured: Captured): Kysely<DB> {
    const postgres = new PostgresDialect({ pool: {} as never });

    const connection: DatabaseConnection = {
        executeQuery: async compiled => {
            captured.queries.push({ sql: compiled.sql, parameters: compiled.parameters });
            return { rows } as QueryResult<never>;
        },
        streamQuery: () => {
            throw new Error('nothing here streams');
        },
    };

    const driver: Driver = Object.assign(new DummyDriver(), {
        acquireConnection: async () => connection,
    });

    const dialect: Dialect = {
        createAdapter: () => postgres.createAdapter(),
        createIntrospector: db => postgres.createIntrospector(db),
        createQueryCompiler: () => postgres.createQueryCompiler(),
        createDriver: () => driver,
    };

    return new Kysely<DB>({ dialect, plugins: [...KyselyDefaultPlugins] });
}

describe('PlayHistoryRepository.lastAiredSince', () => {
    it('answers the newest airing of each song, scoped to the station and bounded by the horizon', async () => {
        const captured: Captured = { queries: [] };
        const yesterday = DateTime.utc().minus({ days: 1 });
        const repository = new PlayHistoryRepository(fakeDb([{ song_key: 'a|one', last_aired_at: yesterday }], captured));

        const lastAired = await repository.lastAiredSince(14, 'main');

        expect(lastAired).toEqual(new Map([['a|one', yesterday]]));
        expect(captured.queries).toHaveLength(1);
        const [query] = captured.queries;
        // Grouped by the SONG, never the catalog row: two copies of one work share one history, so
        // a freshly discovered row of a record the station played yesterday is not fresh.
        expect(query!.sql).toMatch(/max\("aired_at"\) as "last_aired_at"/);
        expect(query!.sql).toMatch(/group by "song_key"/);
        expect(query!.sql).toMatch(/"station_key" = \$1/);
        expect(query!.sql).toContain("now() - '14 days'::interval");
        expect(query!.parameters).toEqual(['main']);
    });

    it('costs no query when the horizon is off', async () => {
        const captured: Captured = { queries: [] };
        const repository = new PlayHistoryRepository(fakeDb([], captured));

        expect(await repository.lastAiredSince(0, 'main')).toEqual(new Map());
        expect(await repository.lastAiredSince(-3, 'main')).toEqual(new Map());
        expect(captured.queries).toEqual([]);
    });

    it('writes a fractional horizon as whole days, since the interval is a literal', async () => {
        // A literal rather than a bound parameter, like the repeat window beside it. What reaches it
        // is a number this code produced, and flooring it is what keeps it a well-formed interval.
        const captured: Captured = { queries: [] };
        const repository = new PlayHistoryRepository(fakeDb([], captured));

        await repository.lastAiredSince(7.9, 'main');

        expect(captured.queries[0]!.sql).toContain("now() - '7 days'::interval");
    });
});
