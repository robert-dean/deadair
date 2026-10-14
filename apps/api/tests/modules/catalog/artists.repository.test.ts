// The acts a brief names, read out of prose by asking which library artists appear in it. The
// database narrows by containment and the whole-word, case-sensitive judgement is made here, so that
// is what is pinned: on rows the test chose, as the narrowed query would answer them.

import { Kysely, PostgresDialect, DummyDriver } from 'kysely';
import type { DatabaseConnection, Dialect, Driver, QueryResult } from 'kysely';
import { KyselyDefaultPlugins } from '@maroonedsoftware/kysely';
import { describe, expect, it } from 'vitest';

import { ArtistsRepository } from '../../../src/modules/catalog/artists.repository.js';
import type { DB } from '../../../src/modules/data/db.js';

/** A database that compiles the statement for real, records it, and answers with rows somebody chose. */
function fakeDb(rows: unknown[], queries: { sql: string; parameters: readonly unknown[] }[]): Kysely<DB> {
    const postgres = new PostgresDialect({ pool: {} as never });
    const connection: DatabaseConnection = {
        executeQuery: async compiled => {
            queries.push({ sql: compiled.sql, parameters: compiled.parameters });
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

describe('ArtistsRepository.namedIn', () => {
    const brief = 'Heavy metal in all its forms, loud. The classics: Black Sabbath, Dio. Thrash: Slayer.';

    it('keeps the artists named as whole words, as written, and drops what only contains one', async () => {
        const queries: { sql: string; parameters: readonly unknown[] }[] = [];
        // What `strpos` would let through: containment, so "Dio" inside "Diopter" is not in the brief,
        // but "Slay" is inside "Slayer" and "Loud" is not (the brief's is lower case).
        const rows = [
            { name: 'Black Sabbath', artist_key: 'black sabbath' },
            { name: 'Dio', artist_key: 'dio' },
            { name: 'Slay', artist_key: 'slay' },
            { name: 'Slayer', artist_key: 'slayer' },
        ];
        const repository = new ArtistsRepository(fakeDb(rows, queries));

        const named = await repository.namedIn(brief);

        expect(named).toEqual([
            { name: 'Black Sabbath', artistKey: 'black sabbath' },
            { name: 'Dio', artistKey: 'dio' },
            { name: 'Slayer', artistKey: 'slayer' },
        ]);
        expect(queries[0]!.sql).toMatch(/strpos\(\$\d+, deadair\.artists\.name\) > 0/);
        expect(queries[0]!.sql).toMatch(/"rating" <> \$\d+/);
        expect(queries[0]!.sql).toMatch(/"merged_into_id" is null/);
    });

    it('drops a library act whose name is only part of a longer one in the brief', async () => {
        const rows = [
            { name: 'Dirty Honey', artist_key: 'dirty honey' },
            { name: 'Honey', artist_key: 'honey' },
            { name: 'The Darkness', artist_key: 'the darkness' },
            { name: 'Darkness', artist_key: 'darkness' },
        ];
        const repository = new ArtistsRepository(fakeDb(rows, []));

        expect(await repository.namedIn('Rival Sons, The Struts, Dirty Honey, The Darkness.')).toEqual([
            { name: 'Dirty Honey', artistKey: 'dirty honey' },
            { name: 'The Darkness', artistKey: 'the darkness' },
        ]);
    });

    it('is case-sensitive, so a lower-case word in the brief is not an act', async () => {
        const repository = new ArtistsRepository(fakeDb([{ name: 'loud', artist_key: 'loud' }], []));

        expect(await repository.namedIn('Loud records only')).toEqual([]);
    });

    it('asks nothing of an empty brief', async () => {
        const queries: { sql: string; parameters: readonly unknown[] }[] = [];
        const repository = new ArtistsRepository(fakeDb([], queries));

        expect(await repository.namedIn('  ')).toEqual([]);
        expect(queries).toHaveLength(0);
    });
});
