// SQL shape only, against a dummy-driven compile: the keys a Skip is written under have to be the
// ones the draw reads, and the window has to be the one asked for.

import { Kysely, PostgresDialect, DummyDriver } from 'kysely';
import type { DatabaseConnection, Dialect, Driver, QueryResult } from 'kysely';
import { KyselyDefaultPlugins } from '@maroonedsoftware/kysely';
import { describe, expect, it } from 'vitest';

import { TrackSkipsRepository } from '../../../src/modules/director/track.skips.repository.js';
import type { RundownItem } from '../../../src/modules/playout/rundown.js';
import { artistKey, songKey } from '../../../src/modules/director/rotation.keys.js';
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

const item = { id: 'i', pluginId: 'spotify', externalId: 'x', title: 'Song', artist: 'The Band', artists: ['The Band', 'A Guest'] } as RundownItem;

describe('TrackSkipsRepository.record', () => {
    it('keys the skip off the lead artist, as play_history does, and sweeps past the retention', async () => {
        const captured: Captured = { statements: [] };
        await new TrackSkipsRepository(fakeDb(captured)).record({ item, stationKey: 'main', afterMs: 12_345.6, actorId: 'actor-1' });

        const [insert, sweep] = captured.statements;
        expect(insert?.sql).toContain('insert into "deadair"."track_skips"');
        expect(insert?.parameters).toEqual(
            expect.arrayContaining(['main', songKey('Song', ['The Band']), artistKey(['The Band']), 12_346, 'actor-1']),
        );
        expect(sweep?.sql).toContain('delete from "deadair"."track_skips"');
        expect(sweep?.sql).toContain("'120 days'");
    });
});

describe('TrackSkipsRepository.lastSkippedSince', () => {
    it('groups by song for one station, inside the window', async () => {
        const captured: Captured = { statements: [] };
        await new TrackSkipsRepository(fakeDb(captured)).lastSkippedSince(14, 'main');

        const sql = captured.statements[0]?.sql ?? '';
        expect(sql).toContain('max("skipped_at")');
        expect(sql).toContain('group by "song_key"');
        expect(sql).toContain("'14 days'");
    });

    it('asks nothing for a window of zero', async () => {
        const captured: Captured = { statements: [] };

        expect(await new TrackSkipsRepository(fakeDb(captured)).lastSkippedSince(0, 'main')).toEqual(new Map());
        expect(captured.statements).toHaveLength(0);
    });
});
