// This repo exercises repository SQL against a real database rather than in the unit suite, so what
// is worth pinning here is what the summary statement COMPILES to and what it makes of the rows that
// come back. Three clauses are load-bearing and silent when wrong: the station filter (a count
// mixing two stations is wrong in a way no console could show), the database-clock cutoff (an app
// host whose clock has drifted would count a different window than the rows were written in), and
// the three conditional counts being three columns of ONE scan rather than three reads of the same
// window.
//
// The mapping half is where the keyless bucket lives — the attempts made while nobody was
// presenting — and it has to arrive as a MISSING property rather than an explicit undefined, since
// the contract's `personaKey` is optional and a JSON body carrying `"personaKey": null` is a
// different answer from one that omits it.

import { Kysely, PostgresDialect, DummyDriver } from 'kysely';
import type { DatabaseConnection, Dialect, Driver, QueryResult } from 'kysely';
import { KyselyDefaultPlugins } from '@maroonedsoftware/kysely';
import { describe, expect, it } from 'vitest';

import { ScriptHistoryRepository } from '../../../src/modules/render/script.history.repository.js';
import type { DB } from '../../../src/modules/data/db.js';
import type { StationIdentity } from '../../../src/modules/shared/station.identity.js';

const STATION = 'a-station';

/** A `Kysely` that fails the test if the repository touches it at all. */
const untouchableDb = (): Kysely<DB> =>
    new Proxy(
        {},
        {
            get(_target, property) {
                throw new Error(`the database was queried (.${String(property)}) when it should not have been`);
            },
        },
    ) as Kysely<DB>;

const identity = (): StationIdentity => ({ stationKey: STATION, current: () => undefined }) as unknown as StationIdentity;

interface Captured {
    sql?: string;
    parameters?: readonly unknown[];
}

/**
 * A database that compiles the statement for real and answers with rows somebody chose.
 *
 * The compiler is Postgres's own and the plugins are the app's, so the SQL asserted below is the SQL
 * a real read would send, camel-case mapping included — which is the half that matters, since these
 * columns are `persona_key` on the wire and `personaKey` in TypeScript.
 */
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

const repositoryOver = (db: Kysely<DB>) => new ScriptHistoryRepository(db, identity());

describe('ScriptHistoryRepository.outcomeCountsSince', () => {
    it('answers nothing for a window of zero without asking the database', async () => {
        await expect(repositoryOver(untouchableDb()).outcomeCountsSince(0)).resolves.toEqual([]);
    });

    it('answers nothing for a negative window without asking the database', async () => {
        await expect(repositoryOver(untouchableDb()).outcomeCountsSince(-3)).resolves.toEqual([]);
    });

    it('counts the three outcomes as three columns of one scan', async () => {
        const captured: Captured = {};
        await repositoryOver(fakeDb([], captured)).outcomeCountsSince(24);

        // Three aggregates in one statement rather than three statements: the answer is per persona
        // AND per outcome, and asking three times would read one window three times to slice it.
        expect(captured.sql?.match(/count\(/g)).toHaveLength(3);
        expect(captured.sql).toContain('case when "outcome"');
        expect(captured.sql).toContain('group by "persona_key"');
    });

    it('counts only this station', async () => {
        const captured: Captured = {};
        await repositoryOver(fakeDb([], captured)).outcomeCountsSince(24);

        expect(captured.sql).toContain('"station_key" =');
        expect(captured.parameters).toContain(STATION);
    });

    it('cuts the window against the database clock', async () => {
        const captured: Captured = {};
        await repositoryOver(fakeDb([], captured)).outcomeCountsSince(24);

        expect(captured.sql).toContain(`now() - '24 hours'::interval`);
    });

    it('floors a fractional window to whole hours', async () => {
        const captured: Captured = {};
        await repositoryOver(fakeDb([], captured)).outcomeCountsSince(24.9);

        expect(captured.sql).toContain(`now() - '24 hours'::interval`);
    });

    it('reads one entry per presenter, with counts as numbers', async () => {
        // Postgres answers a count as a string, and a console drawing `'12' + '3'` would print 123.
        const rows = [
            { persona_key: 'latenight', written: '12', declined: '5', failed: '0' },
            { persona_key: 'pirate', written: '3', declined: '0', failed: '1' },
        ];

        await expect(repositoryOver(fakeDb(rows, {})).outcomeCountsSince(24)).resolves.toEqual([
            { personaKey: 'latenight', written: 12, declined: 5, failed: 0 },
            { personaKey: 'pirate', written: 3, declined: 0, failed: 1 },
        ]);
    });

    it('keeps the attempts nobody was presenting for as their own bucket', async () => {
        const rows = [{ persona_key: null, written: '4', declined: '1', failed: '0' }];

        const [bucket] = await repositoryOver(fakeDb(rows, {})).outcomeCountsSince(24);

        // Absent rather than explicitly undefined: the contract's field is optional, and a body
        // carrying a null persona key is a different claim from one that omits it.
        expect(bucket && 'personaKey' in bucket).toBe(false);
        expect(bucket).toEqual({ written: 4, declined: 1, failed: 0 });
    });
});
