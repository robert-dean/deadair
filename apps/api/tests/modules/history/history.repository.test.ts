// The query is the whole of this module's risk, so it is compiled for real and read back rather
// than mocked. Four things about it are load-bearing and none of them is visible from the result
// shape: the station filter, the extra row that tells a full page from the end, the keyset
// comparison, and the two LEFT joins. An inner join here would silently drop exactly the records
// whose provenance is least tidy — the ones aired straight from a provider, which is most of a
// station running no catalog.

import { Kysely, PostgresDialect, DummyDriver } from 'kysely';
import type { DatabaseConnection, Dialect, Driver, QueryResult } from 'kysely';
import { KyselyDefaultPlugins } from '@maroonedsoftware/kysely';
import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';

import { HistoryRepository } from '../../../src/modules/history/history.repository.js';
import type { DB } from '../../../src/modules/data/db.js';

interface Captured {
    sql?: string;
    parameters?: readonly unknown[];
}

/** A database that compiles the statement for real, records it, and answers with rows somebody chose. */
function fakeDb(rows: unknown[], captured: Captured): Kysely<DB> {
    const postgres = new PostgresDialect({ pool: {} as never });

    const connection: DatabaseConnection = {
        executeQuery: async compiled => {
            captured.sql = compiled.sql;
            captured.parameters = compiled.parameters;
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

const compiledFor = async (query: { stationKey: string; limit: number; before?: string }): Promise<Captured> => {
    const captured: Captured = {};
    await new HistoryRepository(fakeDb([], captured)).page(query);
    return captured;
};

describe('HistoryRepository.page', () => {
    it('scopes every read to one station', async () => {
        const captured = await compiledFor({ stationKey: 'main', limit: 50 });

        expect(captured.sql).toContain('"deadair"."play_history"."station_key" = $');
        expect(captured.parameters).toContain('main');
    });

    it('asks for one row more than the page, which is how the end of the history is told', async () => {
        const captured = await compiledFor({ stationKey: 'main', limit: 50 });

        expect(captured.parameters).toContain(51);
    });

    it('orders newest first, with the id breaking a tie', async () => {
        const captured = await compiledFor({ stationKey: 'main', limit: 10 });

        expect(captured.sql).toContain('order by "deadair"."play_history"."aired_at" desc, "deadair"."play_history"."id" desc');
    });

    it('compares the cursor as a row, so two records aired in the same millisecond are not skipped', async () => {
        const at = DateTime.fromISO('2026-09-06T21:14:05.000Z');
        const captured = await compiledFor({ stationKey: 'main', limit: 10, before: `${at.toISO()}|row-9` });

        expect(captured.sql).toContain('(deadair.play_history.aired_at, deadair.play_history.id) <');
        expect(captured.parameters).toContain('row-9');
    });

    it('reads the whole history when there is no cursor', async () => {
        const captured = await compiledFor({ stationKey: 'main', limit: 10 });

        expect(captured.sql).not.toContain('aired_at, deadair.play_history.id) <');
    });

    it('treats a cursor it did not write as no cursor at all', async () => {
        // A client sending back something that is not a cursor gets the head of the history, which
        // is the same answer it would get for asking with none. Refusing would turn a stale
        // bookmark into an error page.
        const captured = await compiledFor({ stationKey: 'main', limit: 10, before: 'nonsense' });

        expect(captured.sql).not.toContain('aired_at, deadair.play_history.id) <');
    });

    it('joins out to the catalog without dropping a record the catalog never held', async () => {
        const captured = await compiledFor({ stationKey: 'main', limit: 10 });

        expect(captured.sql).toContain('left join "deadair"."tracks"');
        expect(captured.sql).toContain('left join "deadair"."albums"');
        expect(captured.sql).not.toContain('inner join');
    });

    it("reads the record's cover through the same coalesce every catalog read uses", async () => {
        const captured = await compiledFor({ stationKey: 'main', limit: 10 });

        expect(captured.sql).toContain("'art/'");
        expect(captured.sql).toContain('deadair.albums.image_url');
    });

    it('answers rows in the shape the projection expects, cover and all', async () => {
        const airedAt = DateTime.fromISO('2026-09-06T21:14:05.000Z');
        const captured: Captured = {};
        const db = fakeDb(
            [
                {
                    id: 'row-1',
                    airedAt,
                    title: 'Blue Monday',
                    artists: 'New Order',
                    album: 'Power, Corruption & Lies',
                    durationMs: 448_000,
                    trackId: 'track-1',
                    artworkUrl: 'art/abc',
                },
            ],
            captured,
        );

        const rows = await new HistoryRepository(db).page({ stationKey: 'main', limit: 10 });

        expect(rows).toEqual([
            {
                id: 'row-1',
                airedAt,
                title: 'Blue Monday',
                artists: 'New Order',
                album: 'Power, Corruption & Lies',
                artworkUrl: 'art/abc',
                durationMs: 448_000,
                trackId: 'track-1',
            },
        ]);
    });

    it('reads a missing cover as no cover, rather than as a missing key', async () => {
        // `artUrl` names its alias with a plain string, so the column arrives typed as possibly
        // absent as well as possibly null. Both mean the same thing here and the repository says so.
        const captured: Captured = {};
        const db = fakeDb(
            [{ id: 'row-1', airedAt: DateTime.now(), title: 'A Record', artists: 'Somebody', album: null, durationMs: null, trackId: null }],
            captured,
        );

        const [row] = await new HistoryRepository(db).page({ stationKey: 'main', limit: 10 });

        expect(row?.artworkUrl).toBeNull();
    });
});
