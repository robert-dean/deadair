// What is pinned here is the SQL: that a refresh writes only what a plugin may say about a piece and
// never what the station did with it, and that `nextFor` asks two genuinely different questions
// depending on how the series is carried.

import { Kysely, PostgresDialect, DummyDriver } from 'kysely';
import type { DatabaseConnection, Dialect, Driver, QueryResult } from 'kysely';
import { KyselyDefaultPlugins } from '@maroonedsoftware/kysely';
import { describe, expect, it } from 'vitest';

import { NarrationPieceRepository } from '../../../src/modules/narrations/narration.piece.repository.js';
import type { DB } from '../../../src/modules/data/db.js';
import { StationIdentity } from '../../../src/modules/shared/station.identity.js';
import type { NarrationPieceListing } from '../../../src/modules/narrations/narration.piece.js';

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

const listing = (overrides: Partial<NarrationPieceListing> = {}): NarrationPieceListing => ({
    seriesId: 'deadair.audiobook:frankenstein',
    pieceId: 'ch4',
    seriesTitle: 'Frankenstein',
    title: 'Chapter 4',
    seriesOrder: 'serial',
    ordinal: 3,
    wordCount: 3_480,
    ...overrides,
});

/** A row as the driver hands one back, with only what a test cares about filled in. */
const row = (overrides: Record<string, unknown> = {}) => ({
    id: 'piece-1',
    seriesId: 'deadair.audiobook:frankenstein',
    pieceId: 'ch4',
    seriesTitle: 'Frankenstein',
    title: 'Chapter 4',
    seriesOrder: 'serial',
    renderAttempts: 0,
    seenAt: new Date('2026-09-16T10:00:00.000Z'),
    ...overrides,
});

describe('NarrationPieceRepository.record', () => {
    it('upserts on the series and the piece, and answers how many rows were new', async () => {
        const captured: Captured = { queries: [] };
        const repository = new NarrationPieceRepository(fakeDb([{ inserted: true }, { inserted: false }], captured), new StationIdentity());

        const added = await repository.record([listing(), listing({ pieceId: 'ch5', ordinal: 4 })]);

        expect(added).toBe(1);
        const [query] = captured.queries;
        expect(query?.sql).toContain('insert into "deadair"."narration_pieces"');
        expect(query?.sql).toContain('on conflict ("station_key", "series_id", "piece_id") do update set');
        expect(query?.sql).toContain('(xmax = 0)');
    });

    // The whole reason a refresh can run every half hour for a month. It costs more here than it does
    // for a podcast: a re-listed episode that lost its fetch mark is a second download, where a
    // re-listed piece that lost its render mark is the speech engine saying a chapter over again.
    it('never writes what the station did with a piece', async () => {
        const captured: Captured = { queries: [] };
        const repository = new NarrationPieceRepository(fakeDb([{ inserted: false }], captured), new StationIdentity());

        await repository.record([listing()]);

        const updateSet = captured.queries[0]!.sql.split('do update set')[1] ?? '';
        for (const column of ['production_id', 'segment_id', 'render_requested_at', 'render_attempts', 'render_error', 'scheduled_for', 'aired_at']) {
            expect(updateSet, column).not.toContain(column);
        }
    });

    it('drops an ordinal or a word count the table could not hold', async () => {
        const captured: Captured = { queries: [] };
        const repository = new NarrationPieceRepository(fakeDb([{ inserted: true }], captured), new StationIdentity());

        await repository.record([listing({ ordinal: -1, wordCount: 0 })]);

        // Dropped rather than refused: the rest of the listing is still true, and a piece is worth
        // keeping without a word count.
        const { parameters } = captured.queries[0]!;
        expect(parameters).toContain(null);
        expect(parameters).not.toContain(-1);
        expect(parameters).not.toContain(0);
    });

    it('writes nothing at all for an empty listing', async () => {
        const captured: Captured = { queries: [] };
        const repository = new NarrationPieceRepository(fakeDb([], captured), new StationIdentity());

        expect(await repository.record([])).toBe(0);
        expect(captured.queries).toHaveLength(0);
    });
});

describe('NarrationPieceRepository.nextFor', () => {
    it('works a serial forward from the lowest chapter it has not read', async () => {
        const captured: Captured = { queries: [] };
        const repository = new NarrationPieceRepository(fakeDb([row({ seriesOrder: 'serial' })], captured), new StationIdentity());

        const next = await repository.nextFor('deadair.audiobook:frankenstein');

        expect(next?.id).toBe('piece-1');
        // The second query is the answer; the first reads the order off the series' own pieces.
        const asked = captured.queries[1]!.sql;
        expect(asked).toContain('"aired_at" is null');
        expect(asked).toContain('order by "ordinal" asc');
    });

    it('reaches back through a serial the station is part-way through', async () => {
        // Deliberately unlike a podcast: a chapter published years ago is next if the station has not
        // read it. The station's place in the book is `aired_at`, not the calendar.
        const captured: Captured = { queries: [] };
        const repository = new NarrationPieceRepository(fakeDb([row({ seriesOrder: 'serial', ordinal: 3 })], captured), new StationIdentity());

        expect(await repository.nextFor('deadair.audiobook:frankenstein')).toBeDefined();
        expect(captured.queries[1]!.sql).not.toContain('published_at');
    });

    it('takes the newest issue of a latest series', async () => {
        const captured: Captured = { queries: [] };
        const repository = new NarrationPieceRepository(
            fakeDb([row({ seriesOrder: 'latest', publishedAt: new Date('2026-09-15T00:00:00.000Z') })], captured),
            new StationIdentity(),
        );

        const next = await repository.nextFor('deadair.column:notes');

        expect(next?.id).toBe('piece-1');
        const asked = captured.queries[1]!.sql;
        expect(asked).toContain('"published_at" is not null');
        expect(asked).toContain('order by "published_at" desc');
    });

    it('answers nothing for a latest series whose newest issue has aired', async () => {
        // Never back through the archive, which is what carrying a column means: on a night nothing
        // was published the station does not read last week's instead.
        const captured: Captured = { queries: [] };
        const repository = new NarrationPieceRepository(
            fakeDb(
                [
                    row({
                        seriesOrder: 'latest',
                        publishedAt: new Date('2026-09-15T00:00:00.000Z'),
                        airedAt: new Date('2026-09-15T21:00:00.000Z'),
                    }),
                ],
                captured,
            ),
            new StationIdentity(),
        );

        expect(await repository.nextFor('deadair.column:notes')).toBeUndefined();
    });

    it('answers nothing for a series the station holds nothing for', async () => {
        // An operator can name a series on a band before the first refresh has read it.
        const captured: Captured = { queries: [] };
        const repository = new NarrationPieceRepository(fakeDb([], captured), new StationIdentity());

        expect(await repository.nextFor('deadair.audiobook:unknown')).toBeUndefined();
        expect(captured.queries).toHaveLength(1);
    });

    it('reads an order it has never heard of as a serial', async () => {
        // The column is free text on `segments.kind`'s rule. A serial reads something the station has
        // not read; a `latest` could decline forever on a series with no dates at all.
        const captured: Captured = { queries: [] };
        const repository = new NarrationPieceRepository(fakeDb([row({ seriesOrder: 'whatever' })], captured), new StationIdentity());

        await repository.nextFor('deadair.audiobook:frankenstein');

        expect(captured.queries[1]!.sql).toContain('order by "ordinal" asc');
    });
});

describe('NarrationPieceRepository claiming and marking', () => {
    it('claims a render only for a piece with neither audio nor a production', async () => {
        // The `production_id is null` half is what a podcast has no equivalent of: without it a claim
        // taken while a production was already being written would open a second one, and the station
        // would speak the chapter twice.
        const captured: Captured = { queries: [] };
        const repository = new NarrationPieceRepository(fakeDb([{ id: 'piece-1' }], captured), new StationIdentity());

        expect(await repository.claimRender('piece-1', 1_000_000, 60_000)).toBe(true);
        const asked = captured.queries[0]!.sql;
        expect(asked).toContain('"segment_id" is null');
        expect(asked).toContain('"production_id" is null');
        expect(asked).toContain('"render_requested_at" is null');
    });

    it('reports a claim somebody else already holds', async () => {
        const captured: Captured = { queries: [] };
        const repository = new NarrationPieceRepository(fakeDb([], captured), new StationIdentity());

        expect(await repository.claimRender('piece-1', 1_000_000, 60_000)).toBe(false);
    });

    it('takes a production only when the row names none', async () => {
        const captured: Captured = { queries: [] };
        const repository = new NarrationPieceRepository(fakeDb([{ id: 'piece-1' }], captured), new StationIdentity());

        expect(await repository.markProduction('piece-1', 'prod-1')).toBe(true);
        expect(captured.queries[0]!.sql).toContain('"production_id" is null');
    });

    it('clears the production when a render fails, so the piece can be tried again', async () => {
        // Leaving it there would wedge the piece forever behind a `claimRender` that can never win.
        const captured: Captured = { queries: [] };
        const repository = new NarrationPieceRepository(fakeDb([], captured), new StationIdentity());

        await repository.markRenderFailed('piece-1', 'no mixer');

        const asked = captured.queries[0]!.sql;
        expect(asked).toContain('"production_id" = ');
        expect(asked).toContain('"render_attempts" = "render_attempts" +');
    });

    it('keeps the first airing rather than the latest', async () => {
        // A piece re-aired by hand has not stopped having been read, and for a serial this column is
        // also the station's place in the book.
        const captured: Captured = { queries: [] };
        const repository = new NarrationPieceRepository(fakeDb([], captured), new StationIdentity());

        await repository.markAired('seg-1', 1_000_000);

        expect(captured.queries[0]!.sql).toContain('coalesce(aired_at,');
        expect(captured.queries[0]!.sql).toContain('"segment_id" = ');
    });
});
