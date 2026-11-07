// The talk direction's storage. What is pinned is what each statement asks of the table: a read is
// against an instant (the break's air time) when given one and against now when not, a write replaces
// the station's one row and restarts its clock, and every statement is held to this station.

import { Kysely, PostgresDialect, DummyDriver } from 'kysely';
import type { DatabaseConnection, Dialect, Driver, QueryResult } from 'kysely';
import { KyselyDefaultPlugins } from '@maroonedsoftware/kysely';
import { describe, expect, it } from 'vitest';

import { TalkDirectionRepository } from '../../../src/modules/director/talk.direction.repository.js';
import type { DB } from '../../../src/modules/data/db.js';
import type { StationIdentity } from '../../../src/modules/shared/station.identity.js';

interface Captured {
    sql: string;
    parameters: readonly unknown[];
}

function fakeDb(captured: Captured[], rows: Record<string, unknown>[] = []): Kysely<DB> {
    const postgres = new PostgresDialect({ pool: {} as never });
    const connection: DatabaseConnection = {
        executeQuery: async compiled => {
            captured.push({ sql: compiled.sql, parameters: compiled.parameters });
            return { rows, numAffectedRows: 0n } as QueryResult<never>;
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

const station = { stationKey: 'main' } as StationIdentity;

describe('TalkDirectionRepository', () => {
    it('reads the direction against the instant it is given, so a break hears what holds when it airs', async () => {
        const captured: Captured[] = [];
        const repository = new TalkDirectionRepository(fakeDb(captured), station);

        expect(await repository.direction('2026-11-07T21:20:00.000Z')).toBeUndefined();

        expect(captured[0]!.sql).toContain('from "deadair"."talk_directions"');
        expect(captured[0]!.sql).toContain('"ends_at" > $2::timestamptz');
        expect(captured[0]!.parameters).toEqual(['main', '2026-11-07T21:20:00.000Z']);
    });

    it('reads it against now when no instant is given', async () => {
        const captured: Captured[] = [];
        await new TalkDirectionRepository(fakeDb(captured), station).direction();

        expect(captured[0]!.sql).toContain('"ends_at" > now()');
        expect(captured[0]!.parameters).toEqual(['main']);
    });

    it('answers a row as the words and an ISO end', async () => {
        const rows = [{ words: "It's Sam's birthday tonight", endsAt: new Date('2026-11-08T02:00:00.000Z') }];
        const direction = await new TalkDirectionRepository(fakeDb([], rows), station).direction();

        expect(direction).toEqual({ words: "It's Sam's birthday tonight", endsAt: '2026-11-08T02:00:00.000Z' });
    });

    it('replaces the one row a station has, restarting its clock from now', async () => {
        const captured: Captured[] = [];
        const rows = [{ words: 'Snowed in', endsAt: new Date('2026-11-08T02:00:00.000Z') }];
        await new TalkDirectionRepository(fakeDb(captured, rows), station).setDirection('Snowed in', 3);

        expect(captured[0]!.sql).toContain('insert into "deadair"."talk_directions"');
        expect(captured[0]!.sql).toContain('on conflict ("station_key") do update set');
        expect(captured[0]!.sql).toContain('make_interval(hours => $');
        expect(captured[0]!.parameters).toEqual(['main', 'Snowed in', 3, 'Snowed in', 3]);
    });

    it('clears only this station', async () => {
        const captured: Captured[] = [];
        await new TalkDirectionRepository(fakeDb(captured), station).clearDirection();

        expect(captured[0]!.sql).toBe('delete from "deadair"."talk_directions" where "station_key" = $1');
        expect(captured[0]!.parameters).toEqual(['main']);
    });
});
