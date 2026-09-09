// `tellable` is `forPrompt` widened to the whole shelf, and the only reason it exists is that its
// sibling cannot serve a caller writing several breaks in one pass: `forPrompt` answers the
// least-recently-told story and STAYS on it until somebody stamps, and stamping is the one thing a
// caller that is not on air must not do. So an audition of twenty transitions built on `forPrompt`
// would offer one anecdote twenty times and report a character with one story.
//
// What is worth pinning is that the two agree about what is tellable and in what order — the story
// an audition hears first must be the story the next real break would get — and that this read
// spends nothing, which is a property of the statement rather than of the caller.

import { DateTime } from 'luxon';
import { Kysely, PostgresDialect, DummyDriver } from 'kysely';
import type { DatabaseConnection, Dialect, Driver, QueryResult } from 'kysely';
import { KyselyDefaultPlugins } from '@maroonedsoftware/kysely';
import { describe, expect, it } from 'vitest';

import { PersonaStoriesRepository } from '../../../src/modules/personas/persona.stories.repository.js';
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

const repositoryOver = (db: Kysely<DB>) => new PersonaStoriesRepository(db, identity());

/** A detail's own timestamp, as the driver hands one back. */
const WRITTEN = DateTime.fromMillis(Date.UTC(2026, 4, 12, 14, 30));

const storyRow = (id: string, title: string) => ({ id, title, story: `${title}, and what happened next.`, timesTold: '2' });

describe('PersonaStoriesRepository.tellable', () => {
    it('reads only the stories this character may actually tell', async () => {
        const captured: Captured = { statements: [] };
        await repositoryOver(fakeDb([[storyRow('s1', 'The Barstow lights')], []], captured)).tellable('latenight');

        const read = captured.statements[0];
        // `active` only, exactly as `forPrompt` filters: a proposal nobody has looked at must not
        // reach even a preview.
        expect(read?.parameters).toContain('active');
        expect(read?.parameters).toContain('latenight');
        expect(read?.parameters).toContain(STATION);
    });

    it('orders them the way a real break would get them', async () => {
        const captured: Captured = { statements: [] };
        await repositoryOver(fakeDb([[storyRow('s1', 'The Barstow lights')], []], captured)).tellable('latenight');

        // Least recently told first, never-told ahead of every told one, then oldest — so the story
        // an audition hears first is the one the next real break would be given.
        expect(captured.statements[0]?.sql).toContain('last_told_at asc nulls first');
        expect(captured.statements[0]?.sql).toContain('order by');
    });

    it('spends nothing: no stamp, no counter', async () => {
        const captured: Captured = { statements: [] };
        await repositoryOver(fakeDb([[storyRow('s1', 'The Barstow lights')], []], captured)).tellable('latenight');

        // The whole reason this read exists beside `forPrompt` is that a caller not on air must not
        // move the rotation. Two selects and not one update.
        expect(captured.statements.every(statement => statement.sql.startsWith('select'))).toBe(true);
    });

    it('asks nothing more when the character has no stories', async () => {
        const captured: Captured = { statements: [] };
        const shelf = await repositoryOver(fakeDb([[]], captured)).tellable('latenight');

        expect(shelf).toEqual([]);
        // No second read for the details of no stories.
        expect(captured.statements).toHaveLength(1);
    });

    it('hands each story its own details, in one read for all of them', async () => {
        const captured: Captured = { statements: [] };
        const shelf = await repositoryOver(
            fakeDb(
                [
                    [storyRow('s1', 'The Barstow lights'), storyRow('s2', 'The night shift')],
                    [
                        {
                            id: 'd1',
                            storyId: 's1',
                            detail: 'The radio went to static.',
                            state: 'active',
                            origin: 'model',
                            source: null,
                            createdAt: WRITTEN,
                        },
                        {
                            id: 'd2',
                            storyId: 's2',
                            detail: 'Nobody came in until four.',
                            state: 'active',
                            origin: 'operator',
                            source: null,
                            createdAt: WRITTEN,
                        },
                    ],
                ],
                captured,
            ),
        ).tellable('latenight');

        expect(shelf).toHaveLength(2);
        expect(shelf[0]).toMatchObject({ title: 'The Barstow lights', details: ['The radio went to static.'], timesTold: 2 });
        expect(shelf[1]).toMatchObject({ title: 'The night shift', details: ['Nobody came in until four.'] });
        // Two statements for two stories, not three: a shelf of twenty must not be twenty reads.
        expect(captured.statements).toHaveLength(2);
    });

    it('counts the tellings as a number', async () => {
        // Postgres answers a count as a string, and a prompt built on `'2' + 1` would say 21.
        const [story] = await repositoryOver(fakeDb([[storyRow('s1', 'The Barstow lights')], []])).tellable('latenight');

        expect(story?.timesTold).toBe(2);
    });
});
