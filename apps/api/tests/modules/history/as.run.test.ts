// The as-run log's read: the page boundary, the row mapping, and the union's own decisions. The SQL
// was run against a real database while building it (items, a gap placed at its start, air changes,
// a cursor and `until`); what is pinned here is what each statement asks for.

import { DateTime } from 'luxon';
import { Kysely, PostgresDialect, DummyDriver } from 'kysely';
import type { DatabaseConnection, Dialect, Driver, QueryResult } from 'kysely';
import { KyselyDefaultPlugins } from '@maroonedsoftware/kysely';
import { describe, expect, it } from 'vitest';

import { HistoryService } from '../../../src/modules/history/history.service.js';
import { HistoryRepository } from '../../../src/modules/history/history.repository.js';
import { toAsRunEntry, type AsRunRow } from '../../../src/modules/history/as.run.page.js';
import type { DB } from '../../../src/modules/data/db.js';
import type { StationIdentity } from '../../../src/modules/shared/station.identity.js';

const BASE = DateTime.fromISO('2026-10-23T21:00:00.000Z');

const row = (index: number, over: Partial<AsRunRow> = {}): AsRunRow => ({
    id: `row-${index}`,
    kind: 'record',
    at: BASE.minus({ minutes: 3 * index }),
    endedAt: BASE.minus({ minutes: 3 * index - 3 }),
    title: `Record ${index}`,
    artists: 'Somebody',
    trackId: null,
    segmentId: null,
    passedOver: 0,
    detail: null,
    ...over,
});

function fakeDb(rows: unknown[], captured: { sql: string; parameters: readonly unknown[] }[]): Kysely<DB> {
    const postgres = new PostgresDialect({ pool: {} as never });
    const connection: DatabaseConnection = {
        executeQuery: async compiled => {
            captured.push({ sql: compiled.sql, parameters: compiled.parameters });
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

const serviceOver = (rows: AsRunRow[], captured: { sql: string; parameters: readonly unknown[] }[] = []) =>
    new HistoryService(new HistoryRepository(fakeDb(rows, captured)), { stationKey: 'main' } as StationIdentity);

describe('HistoryService.readAsRun', () => {
    it('answers a full page with the cursor the next one starts at, and never the extra row', async () => {
        const page = await serviceOver(Array.from({ length: 3 }, (_unused, index) => row(index))).readAsRun({ limit: 2 });

        expect(page.entries.map(entry => entry.id)).toEqual(['row-0', 'row-1']);
        expect(page.nextBefore).toBe(`${row(1).at.toISO()}|row-1`);
    });

    it('answers the end of the log without a cursor', async () => {
        const page = await serviceOver([row(0)]).readAsRun({ limit: 2 });

        expect(page.nextBefore).toBeUndefined();
    });

    it('scopes both halves of the union to this station and asks for one row more than the page', async () => {
        const captured: { sql: string; parameters: readonly unknown[] }[] = [];
        await serviceOver([], captured).readAsRun({ limit: 10 });

        const [read] = captured;
        expect(read?.parameters.filter(parameter => parameter === 'main')).toHaveLength(2);
        expect(read?.parameters).toContain(11);
        expect(read?.sql).toContain("e.kind in ('gap', 'air.on', 'air.off')");
        expect(read?.sql).toContain('order by u.at desc, u.id desc');
    });

    it('places a gap at its start, worked out from when it closed and how long it ran', async () => {
        const captured: { sql: string; parameters: readonly unknown[] }[] = [];
        await serviceOver([], captured).readAsRun({});

        expect(captured[0]?.sql).toContain("e.created_at - make_interval(secs => coalesce((e.data ->> 'gapMs')::numeric, 0) / 1000.0)");
    });

    it('keys a cursor as a row, and reads from a moment back when asked to', async () => {
        const captured: { sql: string; parameters: readonly unknown[] }[] = [];
        const service = serviceOver([], captured);

        await service.readAsRun({ before: `${BASE.toISO()}|row-4` });
        await service.readAsRun({ until: BASE });

        expect(captured[0]?.sql).toContain('where (u.at, u.id) < (');
        expect(captured[0]?.parameters).toContain('row-4');
        expect(captured[1]?.sql).toContain('where u.at <= ');
    });
});

describe('toAsRunEntry', () => {
    it('carries a record with what it was and leaves the ordinary zero off', () => {
        const entry = toAsRunEntry(row(0, { trackId: 'tr-1' }));

        expect(entry).toMatchObject({ kind: 'record', title: 'Record 0', artists: 'Somebody', trackId: 'tr-1' });
        expect(entry).not.toHaveProperty('passedOver');
        expect(entry).not.toHaveProperty('detail');
    });

    it('reports how many items were passed over to reach one', () => {
        expect(toAsRunEntry(row(0, { passedOver: 3 }))).toMatchObject({ passedOver: 3 });
    });

    it('leaves the end off an item nobody saw end', () => {
        expect(toAsRunEntry(row(0, { endedAt: null }))).not.toHaveProperty('endedAt');
    });

    it('carries a gap or an air change as the station’s own sentence, with no record fields', () => {
        const entry = toAsRunEntry(row(0, { kind: 'offAir', title: null, artists: null, endedAt: null, detail: 'The station was stood down.' }));

        expect(entry).toEqual({ id: 'row-0', kind: 'offAir', at: row(0).at, detail: 'The station was stood down.' });
    });
});
