// What is pinned here is the SQL and the reading of what was stored: every statement is this
// station's, a new listing replaces the old one whole, and a stored row that is not a playlist the
// SDK would recognise never reaches the page, whose contract would refuse it.

import { Kysely, PostgresDialect, DummyDriver } from 'kysely';
import type { DatabaseConnection, Dialect, Driver, QueryResult } from 'kysely';
import { KyselyDefaultPlugins } from '@maroonedsoftware/kysely';
import { describe, expect, it } from 'vitest';

import { ProviderPlaylistsRepository } from '../../../src/modules/catalog/provider.playlists.repository.js';
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
    return { repository: new ProviderPlaylistsRepository(fakeDb(rows, captured), new StationIdentity()), captured };
}

describe('ProviderPlaylistsRepository', () => {
    it("reads this station's listings", async () => {
        const { repository, captured } = repositoryAnswering([
            { pluginId: 'deadair.spotify', listedAt: 'at', playlists: [{ id: 'p1', name: 'Classic rock', trackCount: 92 }] },
        ]);

        const listings = await repository.list();

        expect(listings).toEqual([{ pluginId: 'deadair.spotify', listedAt: 'at', playlists: [{ id: 'p1', name: 'Classic rock', trackCount: 92 }] }]);
        expect(captured.queries[0]?.sql).toContain('from "deadair"."provider_playlist_listings"');
        expect(captured.queries[0]?.sql).toContain('"station_key" = $1');
        expect(captured.queries[0]?.parameters).toEqual(['main']);
    });

    it('drops a stored row with no id or no name, and any field of the wrong type', async () => {
        const { repository } = repositoryAnswering([
            {
                pluginId: 'deadair.spotify',
                listedAt: 'at',
                playlists: [
                    { id: 'p1', name: '' },
                    { name: 'no id' },
                    'not a playlist',
                    { id: 'p2', name: 'Kept', trackCount: 'many', permissions: ['read', 'own'], madeByProvider: false, extra: 'x' },
                ],
            },
        ]);

        const [listing] = await repository.list();

        expect(listing?.playlists).toEqual([{ id: 'p2', name: 'Kept', permissions: ['read'] }]);
    });

    it('reads a listing that is somehow not an array as no playlists', async () => {
        const { repository } = repositoryAnswering([{ pluginId: 'deadair.spotify', listedAt: 'at', playlists: { id: 'p1' } }]);

        const [listing] = await repository.list();

        expect(listing?.playlists).toEqual([]);
    });

    // One row per plugin, replaced whole: a walk that read the list again is the new answer, and
    // the time it was read goes with it.
    it('replaces the listing and its time with an upsert', async () => {
        const { repository, captured } = repositoryAnswering();

        await repository.put('deadair.spotify', [{ id: 'p1', name: 'Classic rock', madeByProvider: true }]);

        const [query] = captured.queries;
        expect(query?.sql).toContain('insert into "deadair"."provider_playlist_listings"');
        expect(query?.sql).toContain('on conflict ("station_key", "plugin_id") do update set "playlists" =');
        expect(query?.sql).toContain('"listed_at" = now()');
        expect(query?.parameters).toContain('main');
        expect(query?.parameters).toContain('deadair.spotify');
        expect(query?.parameters).toContain(JSON.stringify([{ id: 'p1', name: 'Classic rock', madeByProvider: true }]));
    });

    it('keeps only what the SDK says a playlist carries', async () => {
        const { repository, captured } = repositoryAnswering();

        await repository.put('deadair.spotify', [{ id: 'p1', name: 'Classic rock', owner: 'someone' } as never]);

        expect(captured.queries[0]?.parameters).toContain(JSON.stringify([{ id: 'p1', name: 'Classic rock' }]));
    });

    it("forgets only this station's listing for that plugin", async () => {
        const { repository, captured } = repositoryAnswering();

        await repository.remove('deadair.spotify');

        const [query] = captured.queries;
        expect(query?.sql).toContain('delete from "deadair"."provider_playlist_listings"');
        expect(query?.parameters).toEqual(['main', 'deadair.spotify']);
    });
});
