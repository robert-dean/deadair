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

describe('ScriptHistoryRepository.spokenSince', () => {
    it('answers nothing for a window of zero without asking the database', async () => {
        await expect(repositoryOver(untouchableDb()).spokenSince(0, 6, 'broadcast-1')).resolves.toEqual([]);
    });

    it('answers nothing for a limit of zero without asking the database', async () => {
        await expect(repositoryOver(untouchableDb()).spokenSince(3_600_000, 0, 'broadcast-1')).resolves.toEqual([]);
    });

    // A broadcast id names one station already; a time window does not.
    it('reads only this station', async () => {
        const captured: Captured = {};
        await repositoryOver(fakeDb([], captured)).spokenSince(3_600_000, 6, 'broadcast-1');

        expect(captured.sql).toContain('station_key =');
        expect(captured.parameters).toContain(STATION);
    });

    it('cuts the window against the database clock', async () => {
        const captured: Captured = {};
        await repositoryOver(fakeDb([], captured)).spokenSince(3_600_000, 6, 'broadcast-1');

        expect(captured.sql).toContain(`created_at >= now() - '3600000 milliseconds'::interval`);
    });

    // `is distinct from`, so a line written while no broadcast was on still counts: `<>` against a
    // null broadcast answers null and would drop it.
    it('leaves out the broadcast it was asked to, and keeps lines written outside any broadcast', async () => {
        const captured: Captured = {};
        await repositoryOver(fakeDb([], captured)).spokenSince(3_600_000, 6, 'broadcast-1');

        expect(captured.sql).toContain('broadcast_id is distinct from');
        expect(captured.parameters).toContain('broadcast-1');
    });

    it('asks for no broadcast clause when there is no broadcast to leave out', async () => {
        const captured: Captured = {};
        await repositoryOver(fakeDb([], captured)).spokenSince(3_600_000, 6, undefined);

        expect(captured.sql).not.toContain('broadcast_id');
    });

    // The same three clauses `spokenDuring` stands on: only what aired, the latest attempt per
    // segment, newest first.
    it('reads the latest written attempt per segment, newest first', async () => {
        const captured: Captured = {};
        const said = await repositoryOver(fakeDb([{ script: 'the last show signing off' }, { script: 'the one before' }], captured)).spokenSince(
            3_600_000,
            6,
            'broadcast-1',
        );

        expect(captured.sql).toContain(`outcome = 'written'`);
        expect(captured.sql).toContain('distinct on (coalesce(segment_id::text, id::text))');
        expect(captured.sql).toContain('order by said.created_at desc');
        expect(said).toEqual(['the last show signing off', 'the one before']);
    });
});

describe('ScriptHistoryRepository.spokenBy', () => {
    it('answers nothing for a window or a limit of zero without asking the database', async () => {
        await expect(repositoryOver(untouchableDb()).spokenBy('garth', 0, 6)).resolves.toEqual([]);
        await expect(repositoryOver(untouchableDb()).spokenBy('garth', 3_600_000, 0)).resolves.toEqual([]);
    });

    it("reads one character's lines on this station, against the database clock", async () => {
        const captured: Captured = {};
        await repositoryOver(fakeDb([], captured)).spokenBy('garth', 3_600_000, 6);

        expect(captured.sql).toContain('persona_key =');
        expect(captured.parameters).toContain('garth');
        expect(captured.sql).toContain('station_key =');
        expect(captured.parameters).toContain(STATION);
        expect(captured.sql).toContain(`created_at >= now() - '3600000 milliseconds'::interval`);
    });

    // A habit is a habit of the format: Garth's banter turns diluted the share that would have named
    // what his talk breaks kept saying.
    it('narrows to one kind when asked, and reads every kind when not', async () => {
        const narrowed: Captured = {};
        await repositoryOver(fakeDb([], narrowed)).spokenBy('garth', 3_600_000, 6, { kind: 'talkbreak' });
        expect(narrowed.sql).toContain('and kind =');
        expect(narrowed.parameters).toContain('talkbreak');

        const every: Captured = {};
        await repositoryOver(fakeDb([], every)).spokenBy('garth', 3_600_000, 6);
        expect(every.sql).not.toContain('and kind =');
    });

    it('reads the latest written attempt per segment, newest first', async () => {
        const captured: Captured = {};
        const said = await repositoryOver(fakeDb([{ script: 'the newest' }, { script: 'the one before' }], captured)).spokenBy('garth', 3_600_000, 6);

        expect(captured.sql).toContain(`outcome = 'written'`);
        expect(captured.sql).toContain('distinct on (coalesce(segment_id::text, id::text))');
        expect(captured.sql).toContain('order by said.created_at desc');
        expect(said).toEqual(['the newest', 'the one before']);
    });
});

// The memory a break is written with. A break's own earlier attempt is words nobody heard: on a
// rewrite it was the newest line in the list, and a German bulletin rewritten because the record it
// named had left the order was shown its own sentence naming that record and said it again.
describe("ScriptHistoryRepository's memory leaves out the break being written", () => {
    const BREAK = '6f1d2c4e-3b1a-4c5d-9e8f-7a6b5c4d3e2f';

    it('in what the broadcast said', async () => {
        const captured: Captured = {};
        await repositoryOver(fakeDb([], captured)).spokenDuring('broadcast-1', 6, BREAK);

        // `is distinct from`, so an attempt whose segment was deleted (a null id) is still kept.
        expect(captured.sql).toContain('segment_id is distinct from');
        expect(captured.parameters).toContain(BREAK);
    });

    it('in what was said before the broadcast', async () => {
        const captured: Captured = {};
        await repositoryOver(fakeDb([], captured)).spokenSince(3_600_000, 6, 'broadcast-1', BREAK);

        expect(captured.sql).toContain('segment_id is distinct from');
        expect(captured.parameters).toContain(BREAK);
    });

    it("in the presenter's own words", async () => {
        const captured: Captured = {};
        await repositoryOver(fakeDb([], captured)).spokenBy('lotta', 3_600_000, 6, { kind: 'news', excludingSegment: BREAK });

        expect(captured.sql).toContain('segment_id is distinct from');
        expect(captured.parameters).toContain(BREAK);
    });

    it('and leaves nothing out for a reader that is writing no break', async () => {
        const during: Captured = {};
        await repositoryOver(fakeDb([], during)).spokenDuring('broadcast-1', 6);
        const since: Captured = {};
        await repositoryOver(fakeDb([], since)).spokenSince(3_600_000, 6, 'broadcast-1');
        const by: Captured = {};
        await repositoryOver(fakeDb([], by)).spokenBy('lotta', 3_600_000, 6);

        for (const read of [during, since, by]) expect(read.sql).not.toContain('segment_id is distinct from');
    });
});

describe('ScriptHistoryRepository.recordsAround', () => {
    it('answers nothing for a window or a limit of zero without asking the database', async () => {
        await expect(repositoryOver(untouchableDb()).recordsAround(0, 24)).resolves.toEqual([]);
        await expect(repositoryOver(untouchableDb()).recordsAround(3_600_000, 0)).resolves.toEqual([]);
    });

    // Every written attempt, superseded ones included, because a stale name lives in exactly those.
    it("reads every written attempt's neighbours on this station, against the database clock", async () => {
        const captured: Captured = {};
        await repositoryOver(fakeDb([], captured)).recordsAround(3_600_000, 24);

        expect(captured.sql).toContain('station_key =');
        expect(captured.parameters).toContain(STATION);
        expect(captured.sql).toContain(`created_at >= now() - '3600000 milliseconds'::interval`);
        expect(captured.sql).toContain(`outcome = 'written'`);
        expect(captured.sql).not.toContain('distinct on');
    });

    it('answers each record once, newest first, and skips a neighbour with nothing to name', async () => {
        const abba = { title: 'Gimme! Gimme! Gimme!', artist: 'ABBA', facts: ['a fact'] };
        const records = await repositoryOver(
            fakeDb(
                [
                    { previous: { title: 'Rock Me Amadeus', artist: 'Falco' }, next: abba },
                    { previous: undefined, next: { title: 'GIMME! GIMME! GIMME!', artist: 'abba' } },
                    { previous: { title: '', artist: 'Nobody' }, next: 'not a record' },
                ],
                {},
            ),
        ).recordsAround(3_600_000, 24);

        expect(records).toEqual([
            { title: 'Gimme! Gimme! Gimme!', artist: 'ABBA' },
            { title: 'Rock Me Amadeus', artist: 'Falco' },
        ]);
    });
});

describe('ScriptHistoryRepository.page', () => {
    it('answers nothing for a page of zero without asking the database', async () => {
        await expect(repositoryOver(untouchableDb()).page({ limit: 0 })).resolves.toEqual([]);
    });

    it('narrows a segment to the beats of the production it is the joined row of', async () => {
        const captured: Captured = {};
        await repositoryOver(fakeDb([], captured)).page({ limit: 20, segmentId: 'joined-row' });

        // Not an equality: a production airs as ONE row and was written as several, so every
        // attempt behind a phone-in carries a beat's id and a console linking the running order's
        // own item — which is the joined row — would land on an empty page.
        expect(captured.sql).toContain('"segment_id" in (select "deadair"."segments"."id"');
        // The inner select is what keeps it narrow: a production id only for a row with no ordinal.
        expect(captured.sql).toContain('"production_ordinal" is null');
        expect(captured.parameters).toContain('joined-row');
    });

    it('still means itself for a segment that is no production joined row', async () => {
        const captured: Captured = {};
        await repositoryOver(fakeDb([], captured)).page({ limit: 20, segmentId: 'an-ordinary-break' });

        // The `id` arm carries an ordinary break, an imported ident and a single BEAT: somebody who
        // clicked into one turn of a phone-in asked about that turn.
        expect(captured.sql).toContain('"deadair"."segments"."id" =');
    });

    // The keyset is a raw fragment rather than a column Kysely resolves, so it is the one reference
    // in this statement that the ratings join could not qualify on the author's behalf, and
    // `deadair.script_ratings` carries its own `created_at`. Unqualified it is "column reference is
    // ambiguous", which the console saw as a 500 behind "Load older" on every page after the first.
    it('qualifies the keyset columns, which the ratings join makes ambiguous', async () => {
        const captured: Captured = {};
        await repositoryOver(fakeDb([], captured)).page({ limit: 20, before: '2026-09-04T14:19:35.265Z|b793814d-7dfc-4696-8a64-3d825214f061' });

        expect(captured.sql).toContain('(deadair.script_history.created_at, deadair.script_history.id) <');
        // The join whose presence is the whole reason the qualification is needed.
        expect(captured.sql).toContain('left join "deadair"."script_ratings"');
        // Belt and braces on the actual failure: no bare `created_at` anywhere a planner could
        // resolve two ways. Every legitimate mention is table-qualified or quoted as an output name.
        expect(captured.sql).not.toMatch(/[(,]\s*created_at\b/);
    });

    it('walks backwards from the cursor it was given', async () => {
        const captured: Captured = {};
        await repositoryOver(fakeDb([], captured)).page({ limit: 20, before: '2026-09-04T14:19:35.265Z|b793814d-7dfc-4696-8a64-3d825214f061' });

        // Both halves reach the statement as parameters: a model's attempt and the floor's attempt
        // for the same break land in the same millisecond, so the id is what breaks that tie.
        expect(captured.parameters).toContain('b793814d-7dfc-4696-8a64-3d825214f061');

        // The INSTANT rather than the string. `decodeCursor` parses to a `DateTime` and the
        // statement re-serialises it, so what goes on the wire carries the running machine's offset
        // rather than the cursor's `Z`. The same moment, spelled the local way, which is what
        // `::timestamptz` compares. Asserting the text would pass in UTC and fail everywhere else.
        const stamp = captured.parameters?.find(parameter => typeof parameter === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(parameter));
        expect(stamp).toBeDefined();
        expect(Date.parse(stamp as string)).toBe(Date.parse('2026-09-04T14:19:35.265Z'));
    });

    it('asks for no cursor predicate when there is no cursor', async () => {
        const captured: Captured = {};
        await repositoryOver(fakeDb([], captured)).page({ limit: 20 });

        // Why the bug survived: page one is the only page a first load asks for.
        expect(captured.sql).not.toContain('created_at, deadair.script_history.id) <');
    });
});

// The reading a model chose is part of what it wrote, so the record keeps it beside the words.
describe('ScriptHistoryRepository and a delivery', () => {
    it('writes the delivery down with the attempt', async () => {
        const captured: Captured = {};
        await repositoryOver(fakeDb([], captured)).record({
            kind: 'talkbreak',
            writer: 'model',
            outcome: 'written',
            script: 'Quiet now.',
            delivery: 'hushed',
        });

        expect(captured.sql).toContain('"delivery"');
        expect(captured.parameters).toContain('hushed');
    });

    it('reads it back, and reads a word it no longer knows as none', async () => {
        const row = { id: 'a', created_at: null, kind: 'talkbreak', writer: 'model', outcome: 'written', script: 'Go.' };
        const [known, unknown] = await repositoryOver(
            fakeDb(
                [
                    { ...row, delivery: 'frantic' },
                    { ...row, id: 'b', delivery: 'shouty' },
                ],
                {},
            ),
        ).recent(2);

        expect(known?.delivery).toBe('frantic');
        expect(unknown).not.toHaveProperty('delivery');
    });
});

describe('ScriptHistoryRepository.newestWrittenFor', () => {
    it('asks nothing for an order with no segments', async () => {
        const repository = new ScriptHistoryRepository(untouchableDb(), identity());

        expect(await repository.newestWrittenFor([])).toEqual(new Map());
    });

    it('takes the newest written attempt per segment on this station, and leaves an unrated one without a rating', async () => {
        const captured: Captured = {};
        const repository = new ScriptHistoryRepository(
            fakeDb(
                [
                    { id: 'script-1', segmentId: 'seg-1', rating: -1 },
                    { id: 'script-2', segmentId: 'seg-2', rating: null },
                ],
                captured,
            ),
            identity(),
        );

        const written = await repository.newestWrittenFor(['seg-1', 'seg-2']);

        expect(written.get('seg-1')).toEqual({ id: 'script-1', rating: -1 });
        expect(written.get('seg-2')).toEqual({ id: 'script-2' });
        expect(captured.sql).toContain('distinct on ("deadair"."script_history"."segment_id")');
        expect(captured.sql).toContain('"deadair"."script_history"."outcome" = $');
        expect(captured.sql).toMatch(/order by .*"segment_id".*"created_at" desc/);
        expect(captured.parameters).toEqual(expect.arrayContaining([STATION, 'seg-1', 'seg-2', 'written']));
    });
});

describe('ScriptHistoryRepository.performanceSince', () => {
    it('answers nothing for a window of zero without asking the database', async () => {
        await expect(new ScriptHistoryRepository(untouchableDb(), identity()).performanceSince(0)).resolves.toEqual([]);
    });

    it('groups on the reason without what it quoted, on this station only, and reads the counts as numbers', async () => {
        const captured: Captured = {};
        const repository = new ScriptHistoryRepository(
            fakeDb(
                [
                    { personaKey: null, kind: 'talkbreak', outcome: 'declined', reason: 'wording', rating: null, count: '3' },
                    { personaKey: 'wayne', kind: 'talkbreak', outcome: 'written', reason: null, rating: -1, count: '2' },
                ],
                captured,
            ),
            identity(),
        );

        const counts = await repository.performanceSince(30);

        expect(counts).toEqual([
            { kind: 'talkbreak', outcome: 'declined', reason: 'wording', count: 3 },
            { personaKey: 'wayne', kind: 'talkbreak', outcome: 'written', rating: -1, count: 2 },
        ]);
        // The literal twice, once selected and once grouped, since two parameters would not match.
        expect(captured.sql?.match(/split_part\("deadair"\."script_history"\."reason", ': it said "', 1\)/g)).toHaveLength(2);
        expect(captured.sql).toContain("'30 days'");
        expect(captured.parameters).toContain(STATION);
    });
});
