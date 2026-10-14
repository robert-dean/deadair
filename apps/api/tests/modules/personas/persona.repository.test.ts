// Who reads a break. The precedence lives in one method so the words, the phrasing underneath them
// and the voice cannot disagree; what is pinned here is that a bulletin goes to the newsreader when
// there is one, to the presenter when there is not, and that nothing else is asked for one.

import { Kysely, PostgresDialect, DummyDriver } from 'kysely';
import type { DatabaseConnection, Dialect, Driver, QueryResult } from 'kysely';
import { KyselyDefaultPlugins } from '@maroonedsoftware/kysely';
import { describe, expect, it } from 'vitest';

import { PersonaRepository } from '../../../src/modules/personas/persona.repository.js';
import { NEWSREADER_READS } from '../../../src/modules/personas/persona.js';
import { NEWS_KIND } from '../../../src/modules/director/news.break.writer.js';
import type { DB } from '../../../src/modules/data/db.js';
import type { StationIdentity } from '../../../src/modules/shared/station.identity.js';

const STATION = 'a-station';

const identity = (): StationIdentity => ({ stationKey: STATION, current: () => undefined }) as unknown as StationIdentity;

interface Captured {
    statements: { sql: string; parameters: readonly unknown[] }[];
}

/**
 * A database that compiles the statements for real and answers with rows somebody chose.
 *
 * Every statement is kept rather than only the last, because two of these methods send two — the
 * insert and the cursor advance — and the point of the pair is that both went.
 */
function fakeDb(rows: unknown[], captured: Captured = { statements: [] }): Kysely<DB> {
    const postgres = new PostgresDialect({ pool: {} as never });

    const connection: DatabaseConnection = {
        executeQuery: async compiled => {
            captured.statements.push({ sql: compiled.sql, parameters: compiled.parameters });
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

/** A database that answers each statement in turn with the rows given for it, keeping what it was asked. */
function scriptedDb(answers: unknown[][], captured: Captured = { statements: [] }): Kysely<DB> {
    const db = fakeDb([], captured);
    let next = 0;
    const executor = (db as unknown as { getExecutor: () => { executeQuery: (q: unknown) => Promise<unknown> } }).getExecutor();
    const original = executor.executeQuery.bind(executor);
    executor.executeQuery = async (query: unknown) => {
        await original(query);
        return { rows: answers[next++] ?? [] };
    };
    return db;
}

const row = (id: string, kind: string, over: Record<string, unknown> = {}) => ({
    id,
    stationKey: STATION,
    key: id,
    kind,
    kinds: [kind],
    label: id,
    style: `the ${id}`,
    defaultHost: kind === 'host',
    ...over,
});

describe('PersonaRepository.presentingFor', () => {
    it('reads a bulletin as the newsreader, ahead of the host the show named', async () => {
        const captured: Captured = { statements: [] };
        const repository = new PersonaRepository(scriptedDb([[row('newsdesk', 'newsreader')]], captured), identity());

        const reader = await repository.presentingFor('news', 'tonights-host');

        expect(reader?.key).toBe('newsdesk');
        expect(captured.statements[0]?.parameters).toContain('newsreader');
    });

    it('falls back to whoever is presenting when the station has no newsreader', async () => {
        const repository = new PersonaRepository(scriptedDb([[], [row('tonights-host', 'host')]]), identity());

        expect((await repository.presentingFor('news', 'tonights-host'))?.key).toBe('tonights-host');
    });

    it('leaves every other kind of break to the presenter, without asking for the newsreader', async () => {
        const captured: Captured = { statements: [] };
        const repository = new PersonaRepository(scriptedDb([[row('tonights-host', 'host')]], captured), identity());

        expect((await repository.presentingFor('talkbreak', 'tonights-host'))?.key).toBe('tonights-host');
        expect(captured.statements.flatMap(statement => statement.parameters)).not.toContain('newsreader');
    });

    it('means the same word as the news writer does', () => {
        expect(NEWSREADER_READS.has(NEWS_KIND)).toBe(true);
    });
});

// A character may be several things, and what the code reads is the set. `kind` is written beside it
// for clients built before the set existed, so both have to come from the one value on the way in.
describe('PersonaRepository, for a character of several kinds', () => {
    it('reads the set in the order the code ranks it, without what it does not know, and derives the one kind from it', async () => {
        const repository = new PersonaRepository(scriptedDb([[row('peter', 'host', { kinds: ['guest', 'mystery', 'host'] })]]), identity());

        const peter = await repository.find('peter');

        expect(peter?.kinds).toEqual(['host', 'guest']);
        expect(peter?.kind).toBe('host');
    });

    it('reads a set holding nothing it knows as a host, which is what the table meant before there was anything else', async () => {
        const repository = new PersonaRepository(scriptedDb([[row('odd', 'host', { kinds: ['mystery'] })]]), identity());

        expect((await repository.find('odd'))?.kinds).toEqual(['host']);
    });

    it('writes the set and the kind it ranks highest together', async () => {
        const captured: Captured = { statements: [] };
        const repository = new PersonaRepository(scriptedDb([[row('peter', 'host', { kinds: ['host', 'guest'] })]], captured), identity());

        await repository.create({ key: 'peter', kinds: ['guest', 'host'], label: 'Peter', style: 'a ghost' });

        const parameters = captured.statements[0]?.parameters ?? [];
        expect(parameters).toContainEqual(['host', 'guest']);
        expect(parameters).toContain('host');
    });
});
