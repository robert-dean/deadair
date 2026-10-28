// The transaction itself is not visible through this fake (the dummy driver begins and commits
// without a statement), so what is pinned here is the SQL and the reading of what was stored: every statement is this
// station's, an answer replaces the old one whole and beside its ask row, and a null column reads
// back as an absent field rather than a third state.

import { Kysely, PostgresDialect, DummyDriver } from 'kysely';
import type { DatabaseConnection, Dialect, Driver, QueryResult } from 'kysely';
import { KyselyDefaultPlugins } from '@maroonedsoftware/kysely';
import { describe, expect, it } from 'vitest';

import { SimilarityStoreRepository } from '../../../src/modules/similarity/similarity.store.repository.js';
import type { DB } from '../../../src/modules/data/db.js';
import { StationIdentity } from '../../../src/modules/shared/station.identity.js';

interface Captured {
    queries: { sql: string; parameters: readonly unknown[] }[];
}

/** A database that compiles each statement for real, records it, and answers with the next rows queued. */
function fakeDb(answers: unknown[][], captured: Captured): Kysely<DB> {
    const postgres = new PostgresDialect({ pool: {} as never });

    const connection: DatabaseConnection = {
        executeQuery: async compiled => {
            captured.queries.push({ sql: compiled.sql, parameters: compiled.parameters });
            return { rows: answers.shift() ?? [] } as QueryResult<never>;
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

function repositoryAnswering(...answers: unknown[][]) {
    const captured: Captured = { queries: [] };
    return { repository: new SimilarityStoreRepository(fakeDb(answers, captured), new StationIdentity()), captured };
}

describe('SimilarityStoreRepository', () => {
    it('answers nothing for an artist nobody has asked about, without reading the answer table', async () => {
        const { repository, captured } = repositoryAnswering([]);

        expect(await repository.records('slayer')).toBeUndefined();
        expect(captured.queries).toHaveLength(1);
        expect(captured.queries[0]?.sql).toContain('from "deadair"."similarity_asks"');
        expect(captured.queries[0]?.parameters).toEqual(['main', 'records', 'slayer']);
    });

    it('reads a stored answer in rank order, with its age and what was asked for', async () => {
        const { repository, captured } = repositoryAnswering(
            [{ askedLimit: 25, ageMs: '1200.5' }],
            [
                { artistKey: 'slayer', title: 'Raining Blood', artist: 'Slayer', album: 'Reign in Blood', year: 1986, source: 'deadair.deezer' },
                { artistKey: 'slayer', title: 'South of Heaven', artist: 'Slayer', album: undefined, year: undefined, source: 'deadair.deezer' },
            ],
        );

        expect(await repository.records('slayer')).toEqual({
            askedLimit: 25,
            ageMs: 1200.5,
            entries: [
                { title: 'Raining Blood', artist: 'Slayer', album: 'Reign in Blood', year: 1986, source: 'deadair.deezer' },
                { title: 'South of Heaven', artist: 'Slayer', source: 'deadair.deezer' },
            ],
        });
        expect(captured.queries[1]?.sql).toContain('from "deadair"."artist_records"');
        expect(captured.queries[1]?.sql).toContain('order by "artist_key", "rank"');
    });

    it('groups records for several artists from one query', async () => {
        const { repository, captured } = repositoryAnswering([
            { artistKey: 'bathory', title: 'A Fine Day to Die', artist: 'Bathory', source: 'deadair.lastfm' },
            { artistKey: 'mayhem', title: 'Freezing Moon', artist: 'Mayhem', source: 'deadair.lastfm' },
            { artistKey: 'mayhem', title: 'Deathcrush', artist: 'Mayhem', source: 'deadair.lastfm' },
        ]);

        const found = await repository.recordsFor(['bathory', 'mayhem']);

        expect(captured.queries).toHaveLength(1);
        expect([...found.keys()]).toEqual(['bathory', 'mayhem']);
        expect(found.get('mayhem')?.map(record => record.title)).toEqual(['Freezing Moon', 'Deathcrush']);
    });

    it('asks nothing for no artists', async () => {
        const { repository, captured } = repositoryAnswering();

        expect(await repository.recordsFor([])).toEqual(new Map());
        expect(await repository.neighboursFor([])).toEqual(new Map());
        expect(await repository.askedWithin('records', [], 1000)).toEqual(new Set());
        expect(captured.queries).toHaveLength(0);
    });

    it('replaces an answer whole, beside its ask row', async () => {
        const { repository, captured } = repositoryAnswering();

        await repository.saveNeighbours('behemoth', 'Behemoth', 10, [
            { name: 'Mayhem', neighbourKey: 'mayhem', match: 0.9, source: 'deadair.lastfm' },
            { name: 'Emperor', neighbourKey: 'emperor', source: 'deadair.lastfm' },
        ]);

        const statements = captured.queries.map(query => query.sql.split(' ').slice(0, 3).join(' '));
        expect(statements).toEqual([
            'insert into "deadair"."similarity_asks"',
            'delete from "deadair"."similar_artists"',
            'insert into "deadair"."similar_artists"',
        ]);
        expect(captured.queries[0]?.sql).toContain('on conflict ("station_key", "kind", "artist_key") do update');
        expect(captured.queries[2]?.parameters).toEqual([
            'main',
            'behemoth',
            0,
            'Mayhem',
            'mayhem',
            null,
            0.9,
            'deadair.lastfm',
            'main',
            'behemoth',
            1,
            'Emperor',
            'emperor',
            null,
            null,
            'deadair.lastfm',
        ]);
    });

    it('keeps an empty answer as an ask with nothing beside it, so nobody is asked again at once', async () => {
        const { repository, captured } = repositoryAnswering();

        await repository.saveRecords('obscure', 'Obscure', 25, []);

        const statements = captured.queries.map(query => query.sql.split(' ').slice(0, 3).join(' '));
        expect(statements).toEqual(['insert into "deadair"."similarity_asks"', 'delete from "deadair"."artist_records"']);
    });

    describe('edges', () => {
        it('reads stored neighbours as edges, best-ranked first, dropping a self-listing and a name that folds to nothing', async () => {
            const { repository, captured } = repositoryAnswering([
                {
                    artistKey: 'slayer',
                    artistName: 'Slayer',
                    neighbourKey: 'megadeth',
                    name: 'Megadeth',
                    rank: 0,
                    match: '0.82',
                    source: 'deadair.lastfm',
                },
                {
                    artistKey: 'slayer',
                    artistName: 'Slayer',
                    neighbourKey: 'kreator',
                    name: 'Kreator',
                    rank: 1,
                    match: undefined,
                    source: 'deadair.deezer',
                },
            ]);

            expect(await repository.edges({ library: false, limit: 50 })).toEqual([
                { from: 'slayer', fromName: 'Slayer', to: 'megadeth', toName: 'Megadeth', rank: 0, match: 0.82, source: 'deadair.lastfm' },
                { from: 'slayer', fromName: 'Slayer', to: 'kreator', toName: 'Kreator', rank: 1, source: 'deadair.deezer' },
            ]);

            const { sql, parameters } = captured.queries[0]!;
            expect(sql).toContain('from "deadair"."similar_artists" as "sa"');
            expect(sql).toContain('"ask"."kind" = $1');
            expect(sql).toContain('"sa"."neighbour_key" <> "sa"."artist_key"');
            expect(sql).toContain('order by "sa"."rank", "sa"."artist_key" limit');
            expect(sql).not.toContain('exists');
            expect(parameters).toEqual(['artists', 'main', '', 50]);
        });

        it('keeps the edges touching a key from either end', async () => {
            const { repository, captured } = repositoryAnswering([]);

            await repository.edges({ touching: ['slayer'], library: false, limit: 10 });

            expect(captured.queries[0]?.sql).toContain('("sa"."artist_key" in ($4) or "sa"."neighbour_key" in ($5))');
        });

        it('filters to the catalog on both ends before the limit, ignoring merged rows', async () => {
            const { repository, captured } = repositoryAnswering([]);

            await repository.edges({ library: true, limit: 10 });

            const sql = captured.queries[0]!.sql;
            expect(sql.match(/exists \(select "a"\."id" from "deadair"\."artists" as "a"/g)).toHaveLength(2);
            expect(sql).toContain('"a"."artist_key" = "sa"."artist_key"');
            expect(sql).toContain('"a"."artist_key" = "sa"."neighbour_key"');
            expect(sql).toContain('"a"."merged_into_id" is null');
            expect(sql.indexOf('exists')).toBeLessThan(sql.indexOf('limit'));
        });

        it('asks nothing for an empty neighbourhood', async () => {
            const { repository, captured } = repositoryAnswering();

            expect(await repository.edges({ touching: [], library: false, limit: 10 })).toEqual([]);
            expect(captured.queries).toHaveLength(0);
        });
    });
});
