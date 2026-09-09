// This repo exercises repository SQL against a real database rather than in the unit suite, so what
// is worth pinning here is what the statements COMPILE to and what the repository makes of the rows
// that come back. Four things are load-bearing and silent when wrong.
//
// The CLAIM is the whole of the concurrency story: a conditional update on the cursor AND the state
// is what makes a redelivered job free, and dropping either half turns a duplicate delivery into a
// second break at the same ordinal, which the unique index refuses — a failed run rather than a
// no-op. The three settling writes refuse an already-settled row, so a run somebody cancelled cannot
// be reported as `done` or `failed` by a job that was already in flight. `recentScripts` must ask for
// written scripts NEWEST first, since it feeds `recent`, whose whole meaning is order. And the row
// mappers have to DROP absent optionals rather than pass `undefined` through, because these shapes
// reach a JSON body where a missing property and a null are different answers.

import { Kysely, PostgresDialect, DummyDriver } from 'kysely';
import type { DatabaseConnection, Dialect, Driver, QueryResult } from 'kysely';
import { KyselyDefaultPlugins } from '@maroonedsoftware/kysely';
import { describe, expect, it } from 'vitest';

import { PersonaAuditionRepository } from '../../../src/modules/personas/persona.audition.repository.js';
import type { AuditionRecord } from '../../../src/modules/personas/persona.audition.js';
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

const repositoryOver = (db: Kysely<DB>) => new PersonaAuditionRepository(db, identity());

const record = (over: Partial<AuditionRecord> = {}): AuditionRecord => ({
    pluginId: 'spotify',
    externalId: 'track-1',
    title: 'Green Onions',
    artist: 'Booker T. & the M.G.s',
    ...over,
});

/** A row as the columns come back, before the mapper has been at it. */
const auditionRow = (over: Record<string, unknown> = {}) => ({
    id: 'audition-1',
    stationKey: STATION,
    personaId: 'persona-1',
    personaKey: 'latenight',
    sourcePluginId: 'spotify',
    sourcePlaylistId: 'playlist-1',
    sourceName: null,
    records: [record(), record({ externalId: 'track-2', title: "Ain't No Sunshine" })],
    transitions: 1,
    cursor: 0,
    state: 'queued',
    error: null,
    cancelledAt: null,
    finishedAt: null,
    actorId: null,
    createdAt: null,
    ...over,
});

describe('PersonaAuditionRepository.open', () => {
    it('counts the transitions as one fewer than the records', async () => {
        const captured: Captured = { statements: [] };
        await repositoryOver(fakeDb([auditionRow()], captured)).open({
            personaId: 'persona-1',
            personaKey: 'latenight',
            sourcePluginId: 'spotify',
            sourcePlaylistId: 'playlist-1',
            records: [record(), record({ externalId: 'b' }), record({ externalId: 'c' })],
        });

        // Three records make two transitions. Stored rather than derived on read, because every
        // progress read wants the number and the records are a large jsonb nobody should fetch to
        // count.
        expect(captured.statements[0]?.parameters).toContain(2);
    });

    it('stores the records as serialized json rather than an array parameter', async () => {
        const captured: Captured = { statements: [] };
        await repositoryOver(fakeDb([auditionRow()], captured)).open({
            personaId: 'persona-1',
            personaKey: 'latenight',
            sourcePluginId: 'spotify',
            sourcePlaylistId: 'playlist-1',
            records: [record(), record({ externalId: 'b' })],
        });

        // `toJsonb`: a jsonb column is handed text and parses it itself. An array parameter reaches
        // the column as neither valid JSON nor a null.
        const json = captured.statements[0]?.parameters.find(value => typeof value === 'string' && value.startsWith('['));
        expect(json).toBeTypeOf('string');
        expect(JSON.parse(String(json))).toHaveLength(2);
    });

    it('stamps the station it belongs to', async () => {
        const captured: Captured = { statements: [] };
        await repositoryOver(fakeDb([auditionRow()], captured)).open({
            personaId: 'persona-1',
            personaKey: 'latenight',
            sourcePluginId: 'spotify',
            sourcePlaylistId: 'playlist-1',
            records: [record(), record({ externalId: 'b' })],
        });

        expect(captured.statements[0]?.parameters).toContain(STATION);
    });
});

describe('PersonaAuditionRepository.claim', () => {
    it('claims on the cursor and the state together', async () => {
        const captured: Captured = { statements: [] };
        await repositoryOver(fakeDb([auditionRow({ state: 'running' })], captured)).claim('audition-1', 3);

        const claim = captured.statements[0];
        // The cursor half is what makes a duplicate delivery free; the state half is what makes
        // cancellation bite. Neither alone is enough.
        expect(claim?.sql).toContain('"cursor" =');
        expect(claim?.sql).toContain('"state" in');
        expect(claim?.parameters).toContain(3);
        expect(claim?.parameters).toContain('queued');
        expect(claim?.parameters).toContain('running');
    });

    it('answers nothing when the row moved under it', async () => {
        // No row came back, which is a job whose transition somebody else already wrote, or a run
        // that was cancelled. Both stop without going near the model.
        await expect(repositoryOver(fakeDb([])).claim('audition-1', 0)).resolves.toBeUndefined();
    });

    it('moves a queued run to running as it takes the first transition', async () => {
        const captured: Captured = { statements: [] };
        await repositoryOver(fakeDb([auditionRow({ state: 'running' })], captured)).claim('audition-1', 0);

        expect(captured.statements[0]?.parameters[0]).toBe('running');
    });
});

describe('PersonaAuditionRepository.recordBreak', () => {
    it('writes the break and advances the cursor past it', async () => {
        const captured: Captured = { statements: [] };
        await repositoryOver(fakeDb([], captured)).recordBreak('audition-1', 2, {
            previous: record(),
            next: record({ externalId: 'track-2' }),
            attempts: [{ writer: 'model', outcome: 'written', durationMs: 900, script: 'That was Green Onions.' }],
            script: 'That was Green Onions.',
            writer: 'model',
        });

        // Two statements, and the second is the point: a break recorded without the cursor moving
        // would be written again by the next delivery and refused by the unique index.
        expect(captured.statements).toHaveLength(2);
        expect(captured.statements[0]?.sql).toContain('insert into "deadair"."persona_audition_breaks"');
        expect(captured.statements[1]?.sql).toContain('update "deadair"."persona_auditions"');
        expect(captured.statements[1]?.parameters).toContain(3);
    });

    it('advances only from the ordinal this job claimed', async () => {
        const captured: Captured = { statements: [] };
        await repositoryOver(fakeDb([], captured)).recordBreak('audition-1', 2, {
            previous: record(),
            next: record({ externalId: 'track-2' }),
            attempts: [],
        });

        // A run cancelled mid-generation keeps the break the model was already spent on, without
        // being carried on to the next transition.
        expect(captured.statements[1]?.sql).toContain('"cursor" =');
        expect(captured.statements[1]?.parameters).toContain(2);
    });

    it('writes a break nothing wrote as nulls rather than dropping it', async () => {
        const captured: Captured = { statements: [] };
        await repositoryOver(fakeDb([], captured)).recordBreak('audition-1', 0, {
            previous: record(),
            next: record({ externalId: 'track-2' }),
            attempts: [{ writer: 'model', outcome: 'declined', durationMs: 40, reason: 'it named no record' }],
            reason: 'every writer had nothing to say',
        });

        // A transition where every writer declined is a real reading of the sheet and the row that
        // says so is the interesting one. On air it is a break the station skips.
        expect(captured.statements[0]?.parameters).toContain(null);
        expect(captured.statements[0]?.parameters).toContain('every writer had nothing to say');
    });
});

describe('PersonaAuditionRepository.recentScripts', () => {
    it('reads this run’s written scripts, newest first', async () => {
        const captured: Captured = { statements: [] };
        await repositoryOver(fakeDb([{ script: 'the third' }, { script: 'the second' }], captured)).recentScripts('audition-1');

        const read = captured.statements[0];
        expect(read?.sql).toContain('"script" is not null');
        expect(read?.sql).toContain('order by "ordinal" desc');
        // The same window the on-air path uses, so the spent-signature rule fires at the same rate
        // here as it does on a broadcast.
        expect(read?.parameters).toContain(6);
    });

    it('answers the scripts themselves', async () => {
        await expect(repositoryOver(fakeDb([{ script: 'the third' }, { script: 'the second' }])).recentScripts('audition-1')).resolves.toEqual([
            'the third',
            'the second',
        ]);
    });
});

describe('PersonaAuditionRepository settling writes', () => {
    it('refuses to finish a run that has already settled', async () => {
        const captured: Captured = { statements: [] };
        await repositoryOver(fakeDb([], captured)).finish('audition-1');

        expect(captured.statements[0]?.sql).toContain('"state" not in');
        expect(captured.statements[0]?.parameters).toEqual(expect.arrayContaining(['done', 'failed', 'cancelled']));
    });

    it('reports whether finishing actually took', async () => {
        await expect(repositoryOver(fakeDb([])).finish('audition-1')).resolves.toBe(false);
        await expect(repositoryOver(fakeDb([{ id: 'audition-1' }])).finish('audition-1')).resolves.toBe(true);
    });

    it('refuses to fail a run somebody cancelled', async () => {
        // It did not fail; somebody stopped it. Recording the first would make the row say something
        // that did not happen.
        const captured: Captured = { statements: [] };
        await repositoryOver(fakeDb([], captured)).fail('audition-1', 'the model was unreachable');

        expect(captured.statements[0]?.parameters).toContain('the model was unreachable');
        expect(captured.statements[0]?.parameters).toEqual(expect.arrayContaining(['done', 'failed', 'cancelled']));
    });

    it('refuses to cancel a run that is already over', async () => {
        await expect(repositoryOver(fakeDb([])).cancel('audition-1')).resolves.toBe(false);
    });
});

describe('PersonaAuditionRepository row mapping', () => {
    it('drops absent optionals rather than carrying them as undefined', async () => {
        const audition = await repositoryOver(fakeDb([auditionRow()])).findById('audition-1');

        // The contract's fields are optional, and a JSON body carrying `"error": null` is a
        // different answer from one that omits it.
        expect(audition).toBeDefined();
        expect(Object.keys(audition!)).not.toContain('error');
        expect(Object.keys(audition!)).not.toContain('sourceName');
        expect(Object.keys(audition!)).not.toContain('cancelledAt');
        expect(Object.keys(audition!)).not.toContain('actorId');
    });

    it('keeps the ones that are there', async () => {
        const audition = await repositoryOver(
            fakeDb([auditionRow({ sourceName: 'Late night', error: 'the model was unreachable', state: 'failed' })]),
        ).findById('audition-1');

        expect(audition?.sourceName).toBe('Late night');
        expect(audition?.error).toBe('the model was unreachable');
        expect(audition?.state).toBe('failed');
    });

    it('reads the records back as the shapes they were stored as', async () => {
        const audition = await repositoryOver(fakeDb([auditionRow()])).findById('audition-1');

        expect(audition?.records).toHaveLength(2);
        expect(audition?.records[0]?.title).toBe('Green Onions');
        expect(audition?.transitions).toBe(1);
    });

    it('maps a break, dropping the words when nothing wrote any', async () => {
        const [nothing] = await repositoryOver(
            fakeDb([
                {
                    id: 'break-1',
                    auditionId: 'audition-1',
                    ordinal: 0,
                    previous: record(),
                    next: record({ externalId: 'track-2' }),
                    attempts: [{ writer: 'model', outcome: 'declined', durationMs: 40 }],
                    script: null,
                    writer: null,
                    reason: 'every writer had nothing to say',
                    createdAt: null,
                },
            ]),
        ).breaksOf('audition-1');

        expect(Object.keys(nothing!)).not.toContain('script');
        expect(Object.keys(nothing!)).not.toContain('writer');
        expect(nothing?.reason).toBe('every writer had nothing to say');
        expect(nothing?.attempts).toHaveLength(1);
    });

    it('counts what a run has written as a number', async () => {
        // Postgres answers a count as a string, and a console drawing `'4' + 1` would print 41.
        await expect(repositoryOver(fakeDb([{ written: '4' }])).writtenCount('audition-1')).resolves.toBe(4);
    });
});

describe('PersonaAuditionRepository.prune', () => {
    it('keeps the newest runs for this character on this station', async () => {
        const captured: Captured = { statements: [] };
        await repositoryOver(fakeDb([], captured)).prune('persona-1', 30);

        const prune = captured.statements[0];
        expect(prune?.sql).toContain('delete from "deadair"."persona_auditions"');
        expect(prune?.sql).toContain('"id" not in');
        expect(prune?.sql).toContain('order by "created_at" desc');
        expect(prune?.parameters).toContain(30);
        expect(prune?.parameters).toContain('persona-1');
        expect(prune?.parameters).toContain(STATION);
    });
});
