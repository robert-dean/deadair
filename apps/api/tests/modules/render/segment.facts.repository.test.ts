// A break's sources are what somebody is shown as where the host got what it said, so what is worth
// pinning is the handful of ways that could show something untrue:
//
//   * a rewrite REPLACES, including a rewrite handed nothing, or the last write's sources stay
//     beside words that never said them;
//   * the source columns come off `deadair.facts` and never off the caller, and a claim the store no
//     longer holds is left out rather than written without a source;
//   * a claim lost with its record still reads back, without the id it no longer has.

import { Kysely, PostgresDialect, DummyDriver } from 'kysely';
import type { DatabaseConnection, Dialect, Driver, QueryResult } from 'kysely';
import { KyselyDefaultPlugins } from '@maroonedsoftware/kysely';
import { describe, expect, it } from 'vitest';

import { SegmentFactsRepository } from '../../../src/modules/render/segment.facts.repository.js';
import type { DB } from '../../../src/modules/data/db.js';
import type { StationIdentity } from '../../../src/modules/shared/station.identity.js';

const STATION = 'a-station';

const identity = (): StationIdentity => ({ stationKey: STATION, current: () => undefined }) as unknown as StationIdentity;

interface Captured {
    statements: { sql: string; parameters: readonly unknown[] }[];
}

/** A database that compiles for real and answers with rows somebody chose, per statement. */
function fakeDb(answers: unknown[][], captured: Captured = { statements: [] }): Kysely<DB> {
    const postgres = new PostgresDialect({ pool: {} as never });
    let at = 0;

    const connection: DatabaseConnection = {
        executeQuery: async compiled => {
            captured.statements.push({ sql: compiled.sql, parameters: compiled.parameters });
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

const source = (id: string) => ({
    id,
    sourceUrl: `https://en.wikipedia.org/wiki/${id}`,
    sourceQuote: `The span for ${id}.`,
    sourceProvider: 'wikipedia',
});

describe('SegmentFactsRepository', () => {
    describe('replacing a break’s sources', () => {
        it('clears the last write’s and asks nothing more of a write handed nothing', async () => {
            const captured: Captured = { statements: [] };
            const repository = new SegmentFactsRepository(fakeDb([], captured), identity());

            await repository.replaceForSegment('seg-1', []);

            expect(captured.statements).toHaveLength(1);
            expect(captured.statements[0]!.sql).toMatch(/^delete from "deadair"\."segment_facts"/);
            expect(captured.statements[0]!.parameters).toEqual([STATION, 'seg-1']);
        });

        it('copies each source off the stored claim, and leaves out a claim the store no longer holds', async () => {
            const captured: Captured = { statements: [] };
            const repository = new SegmentFactsRepository(fakeDb([[], [source('fact-a')], []], captured), identity());

            await repository.replaceForSegment('seg-1', [
                { factId: 'fact-a', claim: 'Born in New Malden.', told: true },
                { factId: 'fact-gone', claim: 'Its record was deleted mid-write.', told: false },
            ]);

            const insert = captured.statements[2]!;
            expect(insert.sql).toMatch(/^insert into "deadair"\."segment_facts"/);
            expect(insert.parameters).toEqual([
                STATION,
                'seg-1',
                'fact-a',
                'Born in New Malden.',
                'https://en.wikipedia.org/wiki/fact-a',
                'The span for fact-a.',
                'wikipedia',
                true,
            ]);
        });

        it('writes a claim handed twice once', async () => {
            const captured: Captured = { statements: [] };
            const repository = new SegmentFactsRepository(fakeDb([[], [source('fact-a')], []], captured), identity());

            await repository.replaceForSegment('seg-1', [
                { factId: 'fact-a', claim: 'Born in New Malden.', told: false },
                { factId: 'fact-a', claim: 'Born in New Malden.', told: true },
            ]);

            expect(captured.statements[2]!.parameters.filter(value => value === 'fact-a')).toHaveLength(1);
        });

        it('inserts nothing when none of the claims is still stored', async () => {
            const captured: Captured = { statements: [] };
            const repository = new SegmentFactsRepository(fakeDb([[], []], captured), identity());

            await repository.replaceForSegment('seg-1', [{ factId: 'fact-gone', claim: 'Gone.', told: true }]);

            expect(captured.statements).toHaveLength(2);
        });
    });

    describe('reading a break’s sources', () => {
        it('reads them said-first, and drops the id of a claim gone with its record', async () => {
            const captured: Captured = { statements: [] };
            const row = { claim: 'Born in New Malden.', sourceUrl: 'https://x', sourceQuote: 'span', sourceProvider: 'wikipedia', told: true };
            const repository = new SegmentFactsRepository(
                fakeDb(
                    [
                        [
                            { ...row, factId: 'fact-a' },
                            { ...row, factId: undefined, told: false },
                        ],
                    ],
                    captured,
                ),
                identity(),
            );

            await expect(repository.forSegment('seg-1')).resolves.toEqual([
                { ...row, factId: 'fact-a' },
                { ...row, told: false },
            ]);
            expect(captured.statements[0]!.sql).toMatch(/order by "told" desc/);
        });
    });
});
