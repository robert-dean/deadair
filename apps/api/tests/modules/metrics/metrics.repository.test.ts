// The SQL itself is the telemetry package's and was run against Postgres there. What is pinned here is
// what this repository adds on top: that it writes and reads `deadair.metric_samples` under the
// station's key, that the app's CamelCasePlugin does not rename the package's columns, and that a zero
// window deletes nothing without asking the database.

import { Kysely, PostgresDialect, DummyDriver } from 'kysely';
import type { DatabaseConnection, Dialect, Driver, QueryResult } from 'kysely';
import { KyselyDefaultPlugins } from '@maroonedsoftware/kysely';
import { aggregateOf, labelsKey } from '@maroonedsoftware/telemetry';
import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';

import { MetricsRepository } from '../../../src/modules/metrics/metrics.repository.js';
import { StationIdentity } from '../../../src/modules/shared/station.identity.js';
import type { DB } from '../../../src/modules/data/db.js';

interface Captured {
    queries: { sql: string; parameters: readonly unknown[] }[];
}

/** A database that compiles the statement for real, records it, and answers that one row changed. */
function fakeDb(captured: Captured): Kysely<DB> {
    const postgres = new PostgresDialect({ pool: {} as never });
    const connection: DatabaseConnection = {
        executeQuery: async compiled => {
            captured.queries.push({ sql: compiled.sql, parameters: compiled.parameters });
            return { rows: [], numAffectedRows: 1n } as QueryResult<never>;
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

const squash = (text: string) => text.replace(/\s+/g, ' ');

describe('MetricsRepository', () => {
    it('writes minute rows into the station’s table, under its key, with the package’s column names', async () => {
        const captured: Captured = { queries: [] };
        const repository = new MetricsRepository(fakeDb(captured), new StationIdentity());

        await repository.upsertMinutes([
            { name: 'station.listeners', labels: {}, labelsKey: labelsKey({}), start: DateTime.utc(2026, 10, 16, 12), aggregate: aggregateOf(3) },
        ]);

        const [query] = captured.queries;
        expect(squash(query?.sql ?? '')).toContain(
            'insert into "deadair"."metric_samples" as stored ("station_key", "resolution", "bucket", "name", "labels", "labels_key"',
        );
        expect(query?.parameters.slice(0, 2)).toEqual(['main', 'minute']);
        expect(query?.parameters).toContain('station');
    });

    it('folds an hour under the station’s key', async () => {
        const captured: Captured = { queries: [] };
        await new MetricsRepository(fakeDb(captured), new StationIdentity()).rollupHour(DateTime.utc(2026, 10, 16, 12, 30));

        expect(squash(captured.queries[0]?.sql ?? '')).toContain('where "station_key" = $3 and resolution = \'minute\'');
    });

    it('prunes one resolution by its window, and asks nothing at all for a window of zero', async () => {
        const captured: Captured = { queries: [] };
        const repository = new MetricsRepository(fakeDb(captured), new StationIdentity());

        expect(await repository.pruneOlderThanDays('minute', 0)).toBe(0);
        expect(captured.queries).toHaveLength(0);

        await repository.pruneOlderThanDays('minute', 7, DateTime.utc(2026, 10, 16));
        expect(squash(captured.queries[0]?.sql ?? '')).toContain(
            'delete from "deadair"."metric_samples" where "station_key" = $1 and resolution = $2 and bucket < $3',
        );
        expect(captured.queries[0]?.parameters.slice(1)).toEqual(['minute', DateTime.utc(2026, 10, 9).toJSDate()]);
    });
});
