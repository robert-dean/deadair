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

/**
 * A database that compiles the statement for real, records it, and answers with rows somebody chose,
 * and for an UPDATE with no `returning`, with how many rows it says it changed.
 */
function fakeDb(rows: unknown[], captured: Captured, numAffectedRows?: bigint): Kysely<DB> {
    const postgres = new PostgresDialect({ pool: {} as never });

    const connection: DatabaseConnection = {
        executeQuery: async compiled => {
            captured.queries.push({ sql: compiled.sql, parameters: compiled.parameters });
            return { rows, ...(numAffectedRows === undefined ? {} : { numAffectedRows }) } as QueryResult<never>;
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

    // The positive half of the rule above. `withdrawn_at` is what the plugin said, not what the station
    // did, so the upsert does write it: without the reset a piece listed again would stay withdrawn,
    // and a chapter an operator un-skipped would never be read.
    it('brings a piece listed again back from being withdrawn', async () => {
        const captured: Captured = { queries: [] };
        const repository = new NarrationPieceRepository(fakeDb([{ inserted: false }], captured), new StationIdentity());

        await repository.record([listing()]);

        const { sql, parameters } = captured.queries[0]!;
        const updateSet = sql.split('do update set')[1] ?? '';
        const bound = /"withdrawn_at" = \$(\d+)/.exec(updateSet);
        expect(bound, 'withdrawn_at is in the update set').not.toBeNull();
        expect(parameters[Number(bound![1]) - 1]).toBeNull();
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

describe('NarrationPieceRepository.withdraw', () => {
    it('marks what the series did not list, once, and answers how many', async () => {
        const captured: Captured = { queries: [] };
        const repository = new NarrationPieceRepository(fakeDb([], captured, 2n), new StationIdentity());

        expect(await repository.withdraw('deadair.audiobook:frankenstein', ['ch1', 'ch2'])).toBe(2);

        const [query] = captured.queries;
        expect(query?.sql).toContain('update "deadair"."narration_pieces" set "withdrawn_at" = now()');
        expect(query?.sql).toContain('"station_key" = ');
        expect(query?.sql).toContain('"series_id" = ');
        expect(query?.sql).toContain('"piece_id" not in (');
        // Only pieces not already withdrawn, so the time kept is when the plugin first dropped one.
        expect(query?.sql).toContain('"withdrawn_at" is null');
        expect(query?.parameters).toEqual(expect.arrayContaining(['deadair.audiobook:frankenstein', 'ch1', 'ch2']));
    });

    it('withdraws nothing, and asks nothing, for an empty listing', async () => {
        // `not in ()` is not SQL, and an empty listing is what a plugin answers for a book it could not
        // read today. Everything withdrawn would be the wrong answer to both.
        const captured: Captured = { queries: [] };
        const repository = new NarrationPieceRepository(fakeDb([], captured), new StationIdentity());

        expect(await repository.withdraw('deadair.audiobook:frankenstein', [])).toBe(0);
        expect(captured.queries).toHaveLength(0);
    });

    it('reads a withdrawn piece back with when it was withdrawn', async () => {
        const captured: Captured = { queries: [] };
        const repository = new NarrationPieceRepository(
            fakeDb([row({ withdrawnAt: new Date('2026-09-20T12:00:00.000Z') })], captured),
            new StationIdentity(),
        );

        expect((await repository.get('piece-1'))?.withdrawnAt).toBe(Date.parse('2026-09-20T12:00:00.000Z'));
    });

    it('leaves the field absent on a piece still listed', async () => {
        const captured: Captured = { queries: [] };
        const repository = new NarrationPieceRepository(fakeDb([row()], captured), new StationIdentity());

        expect(await repository.get('piece-1')).not.toHaveProperty('withdrawnAt');
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

    // In the query rather than after it: a withdrawn chapter chosen and then refused is the serial
    // stalling on it forever, which is what withdrawal is for.
    it('passes over a chapter the plugin no longer lists', async () => {
        const captured: Captured = { queries: [] };
        const repository = new NarrationPieceRepository(fakeDb([row({ seriesOrder: 'serial' })], captured), new StationIdentity());

        await repository.nextFor('deadair.audiobook:frankenstein');

        expect(captured.queries[1]!.sql).toContain('"withdrawn_at" is null');
    });

    it('takes the newest issue the plugin still lists, not a withdrawn one', async () => {
        const captured: Captured = { queries: [] };
        const repository = new NarrationPieceRepository(
            fakeDb([row({ seriesOrder: 'latest', publishedAt: new Date('2026-09-15T00:00:00.000Z') })], captured),
            new StationIdentity(),
        );

        await repository.nextFor('deadair.column:notes');

        expect(captured.queries[1]!.sql).toContain('"withdrawn_at" is null');
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

    it('never claims a render of a piece the plugin has withdrawn', async () => {
        // Its plugin has stopped offering the words, so asking would only write a failure onto it.
        const captured: Captured = { queries: [] };
        const repository = new NarrationPieceRepository(fakeDb([], captured), new StationIdentity());

        expect(await repository.claimRender('piece-1', 1_000_000, 60_000)).toBe(false);
        expect(captured.queries[0]!.sql).toContain('"withdrawn_at" is null');
    });

    it('reports a claim somebody else already holds', async () => {
        const captured: Captured = { queries: [] };
        const repository = new NarrationPieceRepository(fakeDb([], captured), new StationIdentity());

        expect(await repository.claimRender('piece-1', 1_000_000, 60_000)).toBe(false);
    });

    it('finds every piece a production is being made for, withdrawn or not', async () => {
        // Not through `nextFor`: the piece a production belongs to may no longer be the next one.
        const captured: Captured = { queries: [] };
        const repository = new NarrationPieceRepository(fakeDb([row({ productionId: 'prod-1' })], captured), new StationIdentity());

        const found = await repository.awaitingCollection();

        expect(found[0]?.productionId).toBe('prod-1');
        const asked = captured.queries[0]!.sql;
        expect(asked).toContain('"production_id" is not null');
        expect(asked).toContain('"segment_id" is null');
        expect(asked).not.toContain('withdrawn_at');
        expect(asked).not.toContain('aired_at');
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
