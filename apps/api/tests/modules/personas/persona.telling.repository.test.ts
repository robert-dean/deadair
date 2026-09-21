// The ledger replaces two self-overwriting stamps, and what is worth pinning here is the handful of
// properties the things built on top of it assume without being able to check:
//
//   * a rewrite REPLACES, including rewriting into a break that carries no story at all — the case
//     that leaves a stale row behind if `replaceForSegment` is ever made an upsert;
//   * `markAired` keeps the FIRST airing, because a segment re-aired by hand has not stopped having
//     been heard;
//   * the timestamps come back as the column's own TEXT, which is what stops "roll back to here"
//     deleting the row that was clicked on;
//   * `lastFor` reads only what a listener actually heard, or a break refers back to a telling that
//     was dropped before its slot.

import { Kysely, PostgresDialect, DummyDriver } from 'kysely';
import type { DatabaseConnection, Dialect, Driver, QueryResult } from 'kysely';
import { KyselyDefaultPlugins } from '@maroonedsoftware/kysely';
import { describe, expect, it } from 'vitest';

import { PersonaTellingRepository } from '../../../src/modules/personas/persona.telling.repository.js';
import { PERSONA_TELLING_SAID_LIMIT } from '../../../src/modules/personas/persona.telling.js';
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

const repositoryOver = (db: Kysely<DB>) => new PersonaTellingRepository(db, identity());

const carried = { personaKey: 'latenight', storyId: 's1', source: 'break', mode: 'offered', told: false } as const;

describe('PersonaTellingRepository.replaceForSegment', () => {
    it('clears whatever the last attempt left before writing this one', async () => {
        const captured: Captured = { statements: [] };
        await repositoryOver(fakeDb([[], []], captured)).replaceForSegment('seg-1', { ...carried, told: true, said: 'A line.' });

        expect(captured.statements).toHaveLength(2);
        expect(captured.statements[0]?.sql.startsWith('delete from')).toBe(true);
        expect(captured.statements[0]?.parameters).toContain('seg-1');
        expect(captured.statements[1]?.sql.startsWith('insert into')).toBe(true);
    });

    it('leaves no row at all when the rewrite carries no story', async () => {
        // The case an upsert cannot express, and the one that matters: a break rewritten under a
        // different presenter must take the stale telling with it, or the aired edge stamps a
        // telling that never went out.
        const captured: Captured = { statements: [] };
        await repositoryOver(fakeDb([[]], captured)).replaceForSegment('seg-1', undefined);

        expect(captured.statements).toHaveLength(1);
        expect(captured.statements[0]?.sql.startsWith('delete from')).toBe(true);
    });

    it('scopes both halves to this station', async () => {
        const captured: Captured = { statements: [] };
        await repositoryOver(fakeDb([[], []], captured)).replaceForSegment('seg-1', carried);

        expect(captured.statements[0]?.parameters).toContain(STATION);
        expect(captured.statements[1]?.parameters).toContain(STATION);
    });

    it('carries the segment onto the row it writes', async () => {
        const captured: Captured = { statements: [] };
        await repositoryOver(fakeDb([[], []], captured)).replaceForSegment('seg-1', carried);

        expect(captured.statements[1]?.parameters).toContain('seg-1');
    });
});

describe('PersonaTellingRepository.record', () => {
    it('stores a telling with no segment as null rather than undefined', async () => {
        // A production turn has no segment of its own. `undefined` reaches the driver as a missing
        // parameter rather than a SQL null.
        const captured: Captured = { statements: [] };
        await repositoryOver(fakeDb([[]], captured)).record({ personaKey: 'caller', storyId: 's2', source: 'production', mode: 'told', told: true });

        expect(captured.statements[0]?.parameters).toContain(null);
        expect(captured.statements[0]?.parameters).not.toContain(undefined);
    });

    it('caps what it keeps of the script', async () => {
        const captured: Captured = { statements: [] };
        const long = 'x'.repeat(PERSONA_TELLING_SAID_LIMIT + 500);
        await repositoryOver(fakeDb([[]], captured)).record({ ...carried, told: true, said: long });

        const kept = captured.statements[0]?.parameters.find(value => typeof value === 'string' && value.startsWith('xxx'));
        expect(kept).toHaveLength(PERSONA_TELLING_SAID_LIMIT);
    });

    it('treats a script of nothing but whitespace as no script', async () => {
        const captured: Captured = { statements: [] };
        await repositoryOver(fakeDb([[]], captured)).record({ ...carried, said: '   ' });

        expect(captured.statements[0]?.parameters).toContain(null);
    });
});

describe('PersonaTellingRepository.markAired', () => {
    it('keeps the first airing and is keyed on the segment', async () => {
        const captured: Captured = { statements: [] };
        await repositoryOver(fakeDb([[]], captured)).markAired('seg-1', Date.UTC(2026, 4, 12, 14, 30));

        expect(captured.statements[0]?.sql).toContain('coalesce(aired_at,');
        expect(captured.statements[0]?.parameters).toContain('seg-1');
        expect(captured.statements[0]?.parameters).toContain(STATION);
    });

    it('is one statement whether or not the segment carried a story', async () => {
        // One statement matching nothing is cheaper than asking first, which is the posture
        // `NarrationPieceRepository.markAired` already takes on the same edge.
        const captured: Captured = { statements: [] };
        await repositoryOver(fakeDb([[]], captured)).markAired('seg-none', 0);

        expect(captured.statements).toHaveLength(1);
    });
});

describe('PersonaTellingRepository.timeline', () => {
    it("reads the timestamps as the column's own text, not as a date", async () => {
        // Postgres keeps a `timestamptz` to the microsecond and Luxon cannot represent one, so a
        // round trip truncates and the value compares as EARLIER than its own row. This string is
        // handed straight back as "roll back to here".
        const captured: Captured = { statements: [] };
        await repositoryOver(fakeDb([[]], captured)).timeline('latenight');

        expect(captured.statements[0]?.sql).toContain('created_at::text');
        expect(captured.statements[0]?.sql).toContain('aired_at::text');
    });

    it('answers newest first, with the story each telling told', async () => {
        const rows = [
            {
                id: 't2',
                personaKey: 'latenight',
                storyId: 's1',
                segmentId: 'seg-2',
                source: 'break',
                mode: 'offered',
                told: true,
                said: 'And the radio went to static.',
                title: 'The Barstow lights',
                at: '2026-05-12 14:30:00.123456+00',
                airedAt: '2026-05-12 14:31:00.5+00',
            },
        ];

        const captured: Captured = { statements: [] };
        const timeline = await repositoryOver(fakeDb([rows], captured)).timeline('latenight');

        expect(captured.statements[0]?.sql).toContain('order by');
        expect(captured.statements[0]?.sql).toContain('desc');
        expect(timeline[0]).toMatchObject({
            title: 'The Barstow lights',
            told: true,
            at: '2026-05-12 14:30:00.123456+00',
            airedAt: '2026-05-12 14:31:00.5+00',
        });
    });

    it('drops an absent segment and an unaired mark rather than passing null through', async () => {
        // The tree's own rule: a repository's mapper answers `undefined`-means-not-set and never a
        // third state, because the driver hands back `undefined` while the types say `null`.
        const rows = [
            {
                id: 't1',
                personaKey: 'latenight',
                storyId: 's1',
                segmentId: null,
                source: 'backfill',
                mode: 'offered',
                told: true,
                said: null,
                title: 'The Barstow lights',
                at: '2026-05-01 00:00:00+00',
                airedAt: null,
            },
        ];

        const [entry] = await repositoryOver(fakeDb([rows])).timeline('latenight');

        expect(entry).not.toHaveProperty('segmentId');
        expect(entry).not.toHaveProperty('said');
        expect(entry).not.toHaveProperty('airedAt');
    });
});

describe('PersonaTellingRepository.lastFor', () => {
    it('reads only what a listener actually heard', async () => {
        const captured: Captured = { statements: [] };
        await repositoryOver(fakeDb([[]], captured)).lastFor('s1');

        // Told AND aired: a story written into a break that was dropped is one nobody has heard, and
        // offering it back as somewhere the character has already been would have the presenter
        // refer to something that never happened.
        expect(captured.statements[0]?.parameters).toContain(true);
        expect(captured.statements[0]?.sql).toContain('aired_at');
        expect(captured.statements[0]?.sql).toContain('is not null');
    });

    it('answers the most recent first and stops at the limit it was given', async () => {
        const captured: Captured = { statements: [] };
        await repositoryOver(fakeDb([[]], captured)).lastFor('s1', 2);

        expect(captured.statements[0]?.sql).toContain('desc');
        expect(captured.statements[0]?.parameters).toContain(2);
    });
});
