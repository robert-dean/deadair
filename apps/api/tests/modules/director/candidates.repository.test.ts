// The rest of this repository is covered end to end by `pick.resolver.test.ts`, which fakes
// `CandidatesRepository` outright. What is worth pinning HERE, against a real (dummy-driven)
// compile, is that the SQL `sample` and `ratingsFor` actually send carries the credited-artist veto
// (`noCreditedDislike`/`creditedDislikeExists` are shared with `tracks.repository.ts`), and a typo
// in either query's use of them would compile, run, and simply never veto anything.

import { Kysely, PostgresDialect, DummyDriver } from 'kysely';
import type { DatabaseConnection, Dialect, Driver, QueryResult } from 'kysely';
import { KyselyDefaultPlugins } from '@maroonedsoftware/kysely';
import { describe, expect, it } from 'vitest';

import { CandidatesRepository } from '../../../src/modules/director/candidates.repository.js';
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

describe('CandidatesRepository.sample', () => {
    it('carries the credited-artist veto beside its three rating filters', async () => {
        const captured: Captured = { statements: [] };
        await new CandidatesRepository(fakeDb(captured)).sample(10);

        const [statement] = captured.statements;
        expect(statement?.sql).toContain('track_artists');
        expect(statement?.sql).toContain('not exists');
        // The join that resolves a guest's identity, not the lead's.
        expect(statement?.sql).toContain('"ca"."rating"');
    });
});

describe('CandidatesRepository.sample round a never-play rule', () => {
    // The SQL half of the early filter may only ever be EQUALITY, case and outer space aside: anything
    // looser is a second genre matcher, and in the exclude direction a disagreement with
    // `genre.match.ts` is a record refused that no rule names (Ideas #22).
    it('leaves nothing out when nothing is refused', async () => {
        const captured: Captured = { statements: [] };
        await new CandidatesRepository(fakeDb(captured)).sample(10);

        const [statement] = captured.statements;
        expect(statement?.sql).not.toContain('lower(btrim(tag))');
        expect(statement?.sql).not.toContain('not in');
    });

    it('leaves out a record or artist tagged exactly a refused value, folded only for case and space', async () => {
        const captured: Captured = { statements: [] };
        await new CandidatesRepository(fakeDb(captured)).sample(10, undefined, undefined, undefined, undefined, {
            refusedTags: [' Country ', 'country', 'Live'],
        });

        const [statement] = captured.statements;
        expect(statement?.sql).toContain('not exists');
        expect(statement?.sql).toContain('lower(btrim(tag)) = any');
        expect(statement?.sql).toContain('track_enrichment');
        expect(statement?.sql).toContain('artist_enrichment');
        expect(statement?.sql).not.toMatch(/ilike/);
        expect(statement?.parameters).toContainEqual(['country', 'live']);
    });

    it('leaves out what an earlier draw already returned', async () => {
        const captured: Captured = { statements: [] };
        await new CandidatesRepository(fakeDb(captured)).sample(10, undefined, undefined, undefined, undefined, { trackIds: ['t1', 't2'] });

        const [statement] = captured.statements;
        expect(statement?.sql).toMatch(/"deadair"\."tracks"\."id" not in \(\$\d+, \$\d+\)/);
        expect(statement?.parameters).toEqual(expect.arrayContaining(['t1', 't2']));
    });
});

describe('CandidatesRepository.sample length bounds', () => {
    // A9: the same `exists` subquery the live-binding test already runs also carries the length
    // bound, on the same `duration_ms` column `bindingsFor` reads its own from -- so the draw and
    // the resolver's later judgement of a chosen binding agree on the same fact.
    it('carries no duration predicate when no bound is set', async () => {
        const captured: Captured = { statements: [] };
        await new CandidatesRepository(fakeDb(captured)).sample(10);

        const [statement] = captured.statements;
        expect(statement?.sql).not.toContain('duration_ms');
    });

    it('carries the floor, unmeasured passing beside it, when a minimum is set', async () => {
        const captured: Captured = { statements: [] };
        await new CandidatesRepository(fakeDb(captured)).sample(10, undefined, undefined, { minMs: 60_000 });

        const [statement] = captured.statements;
        expect(statement?.sql).toContain('duration_ms');
        expect(statement?.sql).toContain('is null');
        expect(statement?.parameters).toContain(60_000);
    });

    it('carries the ceiling when a maximum is set', async () => {
        const captured: Captured = { statements: [] };
        await new CandidatesRepository(fakeDb(captured)).sample(10, undefined, undefined, { maxMs: 900_000 });

        const [statement] = captured.statements;
        expect(statement?.sql).toContain('duration_ms');
        expect(statement?.parameters).toContain(900_000);
    });

    it('carries both ends when both are set', async () => {
        const captured: Captured = { statements: [] };
        await new CandidatesRepository(fakeDb(captured)).sample(10, undefined, undefined, { minMs: 60_000, maxMs: 900_000 });

        const [statement] = captured.statements;
        expect(statement?.parameters).toContain(60_000);
        expect(statement?.parameters).toContain(900_000);
    });
});

describe('CandidatesRepository.ratingsFor', () => {
    it('folds the same credited-artist veto into the effective rating it computes', async () => {
        const captured: Captured = { statements: [] };
        await new CandidatesRepository(fakeDb(captured)).ratingsFor(['track-1']);

        const [statement] = captured.statements;
        // Raw form here, not `noCreditedDislike`'s Kysely `not exists`: `effectiveRating` folds
        // the POSITIVE `exists` into `least()` instead of filtering rows out.
        expect(statement?.sql).toContain('track_artists');
        expect(statement?.sql).toContain('exists');
        expect(statement?.sql).toContain('least');
    });
});

describe('CandidatesRepository.tagsFor', () => {
    it('reads the genre arrays at the track and at its artist, guarded against a plugin that wrote no array', async () => {
        const captured: Captured = { statements: [] };
        await new CandidatesRepository(fakeDb(captured)).tagsFor(['track-1']);

        const sql = captured.statements[0]?.sql ?? '';
        expect(sql).toContain('from deadair.track_enrichment e');
        expect(sql).toContain('from deadair.artist_enrichment e');
        expect(sql).toContain("jsonb_typeof(e.data -> 'genres') = 'array'");
        // The array is the data; the promoted scalar is a convenience the rules never read.
        expect(sql).not.toContain('"genre"');
    });

    it('asks nothing for no tracks', async () => {
        const captured: Captured = { statements: [] };
        expect((await new CandidatesRepository(fakeDb(captured)).tagsFor([])).size).toBe(0);
        expect(captured.statements).toHaveLength(0);
    });
});
