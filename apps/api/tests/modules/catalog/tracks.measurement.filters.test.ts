// Two filters over what the measurement walk did, beside the record-state filter: which analysis
// plugin measured a record, and which way its measurement failed. What is pinned here is that each
// reaches the SQL the way it means, that both sit beside the state rather than replacing it, and
// that the counts an operator picks them from are drawn over the whole set and not over the choice.
//
// The database compiles every statement for real and answers with rows a case chose, in order.

import { Kysely, PostgresDialect, DummyDriver } from 'kysely';
import type { DatabaseConnection, Dialect, Driver, QueryResult } from 'kysely';
import { KyselyDefaultPlugins } from '@maroonedsoftware/kysely';
import { describe, expect, it } from 'vitest';

import { TracksRepository } from '../../../src/modules/catalog/tracks.repository.js';
import type { TrackListQuery } from '../../../src/modules/catalog/tracks.repository.js';
import type { DB } from '../../../src/modules/data/db.js';

interface Captured {
    sql: string;
    parameters: readonly unknown[];
}

function fakeDb(answers: unknown[][], captured: Captured[]): Kysely<DB> {
    const postgres = new PostgresDialect({ pool: {} as never });
    let at = 0;
    const connection: DatabaseConnection = {
        executeQuery: async compiled => {
            captured.push({ sql: compiled.sql, parameters: compiled.parameters });
            return { rows: answers[at++] ?? [] } as QueryResult<never>;
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

const LIST: TrackListQuery = { limit: 10, offset: 0, sort: 'asc', sortBy: 'title', schemaVersion: 1 };

const COUNTED = {
    total: '9',
    cached: '1',
    measured: '2',
    enriched: '3',
    benched: '0',
    failing: '0',
    suspended: '1',
    lyrics: '0',
    synced: '0',
    instrumental: '0',
    moods: '0',
    unfetchable: '2',
    undecodable: '1',
    truncated: '0',
};

describe('the measurement filters on a track list', () => {
    it('narrows to what one analysis plugin measured, whether it worked or not', async () => {
        const captured: Captured[] = [];
        await new TracksRepository(fakeDb([[{ total: '0' }], []], captured)).listTracks({ ...LIST, analyzer: 'deadair.analyzer' });

        const [count] = captured;
        expect(count?.sql).toContain('"an"."analyzer_plugin_id" = $');
        expect(count?.parameters).toContain('deadair.analyzer');
        // Failures are the detector's too, so nothing here asks whether it succeeded.
        expect(count?.sql).not.toContain('"an"."failed_at"');
    });

    it('narrows to one kind of failure, reading a failure with no code as undecodable', async () => {
        const captured: Captured[] = [];
        await new TracksRepository(fakeDb([[{ total: '0' }], []], captured)).listTracks({ ...LIST, measureFailure: 'undecodable' });

        const [count] = captured;
        expect(count?.sql).toContain('"an"."failed_at" is not null');
        expect(count?.sql).toContain("coalesce(an.failure_code, 'undecodable') = $");
        expect(count?.parameters).toContain('undecodable');
    });

    it('applies both beside the state, so a list can be all three at once', async () => {
        const captured: Captured[] = [];
        await new TracksRepository(fakeDb([[{ total: '0' }], []], captured)).listTracks({
            ...LIST,
            state: 'unmeasured',
            analyzer: 'deadair.analyzer',
            measureFailure: 'truncated',
        });

        const where = captured[0]?.sql ?? '';
        expect(where).toContain('"an"."complete" = $');
        expect(where).toContain('"an"."analyzer_plugin_id" = $');
        expect(where).toContain("coalesce(an.failure_code, 'undecodable') = $");
    });

    it('counts each kind of failure and every analyzer over the whole set, never over the filter chosen', async () => {
        const captured: Captured[] = [];
        const repository = new TracksRepository(fakeDb([[COUNTED], [{ pluginId: 'deadair.analyzer', count: '2' }]], captured));

        const counts = await repository.trackStateCounts({ ...LIST, analyzer: 'other.plugin', measureFailure: 'truncated' });

        expect(counts.measureFailures).toEqual({ unfetchable: 2, undecodable: 1, truncated: 0 });
        expect(counts.analyzers).toEqual([{ pluginId: 'deadair.analyzer', count: 2 }]);
        // Neither filter reaches either statement: the counts are what the filter is chosen from.
        for (const statement of captured) {
            expect(statement.parameters).not.toContain('other.plugin');
        }
        expect(captured[1]?.sql).toContain('group by "an"."analyzer_plugin_id"');
    });
});
