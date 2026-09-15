// What is pinned here is the SQL: that every statement is this station's, that hiding twice is one
// hide, and that the key a caller builds its lookup from cannot confuse two different pairs.

import { Kysely, PostgresDialect, DummyDriver } from 'kysely';
import type { DatabaseConnection, Dialect, Driver, QueryResult } from 'kysely';
import { KyselyDefaultPlugins } from '@maroonedsoftware/kysely';
import { describe, expect, it } from 'vitest';

import { HiddenPlaylistsRepository, hiddenPlaylistKey } from '../../../src/modules/catalog/hidden.playlists.repository.js';
import type { DB } from '../../../src/modules/data/db.js';
import { StationIdentity } from '../../../src/modules/shared/station.identity.js';

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

    const driver: Driver = Object.assign(new DummyDriver(), { acquireConnection: async () => connection });

    const dialect: Dialect = {
        createAdapter: () => postgres.createAdapter(),
        createIntrospector: db => postgres.createIntrospector(db),
        createQueryCompiler: () => postgres.createQueryCompiler(),
        createDriver: () => driver,
    };

    return new Kysely<DB>({ dialect, plugins: [...KyselyDefaultPlugins] });
}

function repositoryAnswering(rows: unknown[] = []) {
    const captured: Captured = { queries: [] };
    return { repository: new HiddenPlaylistsRepository(fakeDb(rows, captured), new StationIdentity()), captured };
}

describe('HiddenPlaylistsRepository', () => {
    it("lists this station's hidden pairs", async () => {
        const { repository, captured } = repositoryAnswering([{ pluginId: 'deadair.spotify', playlistId: 'p1' }]);

        const hidden = await repository.list();

        expect(hidden).toEqual([{ pluginId: 'deadair.spotify', playlistId: 'p1' }]);
        expect(captured.queries[0]?.sql).toContain('from "deadair"."hidden_playlists"');
        expect(captured.queries[0]?.sql).toContain('"station_key" = $1');
        expect(captured.queries[0]?.parameters).toEqual(['main']);
    });

    it('answers the same pairs as keys a listing can be checked against', async () => {
        const { repository } = repositoryAnswering([
            { pluginId: 'deadair.spotify', playlistId: 'p1' },
            { pluginId: 'deadair.navidrome', playlistId: 'p1' },
        ]);

        const keys = await repository.keys();

        expect(keys.has(hiddenPlaylistKey('deadair.spotify', 'p1'))).toBe(true);
        expect(keys.has(hiddenPlaylistKey('deadair.navidrome', 'p1'))).toBe(true);
        expect(keys.has(hiddenPlaylistKey('deadair.spotify', 'p2'))).toBe(false);
    });

    // Pressing Hide on a playlist that is already hidden (a second tab, a double click) must not be
    // an error, so the insert yields to the row that is there.
    it('hides with an insert that yields to a row already there', async () => {
        const { repository, captured } = repositoryAnswering();

        await repository.hide('deadair.spotify', 'p1');

        const [query] = captured.queries;
        expect(query?.sql).toContain('insert into "deadair"."hidden_playlists"');
        expect(query?.sql).toContain('on conflict ("station_key", "plugin_id", "playlist_id") do nothing');
        expect(query?.parameters).toEqual(['main', 'deadair.spotify', 'p1']);
    });

    it("shows again by deleting only this station's row for that pair", async () => {
        const { repository, captured } = repositoryAnswering();

        await repository.show('deadair.spotify', 'p1');

        const [query] = captured.queries;
        expect(query?.sql).toContain('delete from "deadair"."hidden_playlists"');
        expect(query?.sql).toContain('"station_key" = $1');
        expect(query?.sql).toContain('"plugin_id" = $2');
        expect(query?.sql).toContain('"playlist_id" = $3');
        expect(query?.parameters).toEqual(['main', 'deadair.spotify', 'p1']);
    });
});

describe('hiddenPlaylistKey', () => {
    // Both halves are somebody else's text, so a separator either of them could contain would let
    // two different pairs collide and hide a playlist nobody chose.
    it('keeps apart two pairs that would read the same under a printable separator', () => {
        expect(hiddenPlaylistKey('a:b', 'c')).not.toBe(hiddenPlaylistKey('a', 'b:c'));
        expect(hiddenPlaylistKey('a.b', 'c')).not.toBe(hiddenPlaylistKey('a', 'b.c'));
    });
});
