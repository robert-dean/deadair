// The as-run log is written on the aired edge from two scopes that can land out of order, so what
// is pinned is what each statement asks for: which kind each item is written as, where a break's
// segment is found, and that a close only ever reaches back in time. Ordering itself was run
// against a real database while building this, since that half is SQL.

import { Kysely, PostgresDialect, DummyDriver } from 'kysely';
import type { DatabaseConnection, Dialect, Driver, QueryResult } from 'kysely';
import { KyselyDefaultPlugins } from '@maroonedsoftware/kysely';
import { describe, expect, it } from 'vitest';

import { AsRunRepository } from '../../../src/modules/director/as.run.repository.js';
import type { DB } from '../../../src/modules/data/db.js';
import type { RundownItem } from '../../../src/modules/playout/rundown.js';
import { RENDER_PLUGIN_ID } from '../../../src/modules/render/segment.source.js';

interface Captured {
    sql: string;
    parameters: readonly unknown[];
}

function fakeDb(captured: Captured[]): Kysely<DB> {
    const postgres = new PostgresDialect({ pool: {} as never });
    const connection: DatabaseConnection = {
        executeQuery: async compiled => {
            captured.push({ sql: compiled.sql, parameters: compiled.parameters });
            return { rows: [], numAffectedRows: 0n } as QueryResult<never>;
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

const record: RundownItem = {
    id: 'item-1',
    pluginId: 'deadair.spotify',
    externalId: 'sp-1',
    title: 'Pink Moon',
    artists: ['Nick Drake'],
    artist: 'Nick Drake',
    trackId: '00000000-0000-4000-8000-000000000001',
};
const SEGMENT = '00000000-0000-4000-8000-0000000000bb';
const breakItem: RundownItem = {
    id: 'item-2',
    pluginId: RENDER_PLUGIN_ID,
    externalId: SEGMENT,
    title: 'Talk break: one into two',
    artists: [],
    artist: '',
};

async function write(item: RundownItem) {
    const captured: Captured[] = [];
    await new AsRunRepository(fakeDb(captured)).record({ item, stationKey: 'main', source: 'import', passedOver: 3, at: Date.UTC(2026, 9, 23, 20) });
    return captured;
}

describe('AsRunRepository.record', () => {
    it('closes what came before, then opens this one', async () => {
        const [close, insert] = await write(record);

        expect(close?.sql).toMatch(/^update "deadair"\."as_run"/);
        expect(insert?.sql).toMatch(/^insert into "deadair"\."as_run"/);
    });

    it('writes a record with its catalog track and what put it on', async () => {
        const [, insert] = await write(record);

        expect(insert?.parameters).toEqual(expect.arrayContaining(['record', record.trackId, 'Pink Moon', 'Nick Drake', 'import', 3]));
    });

    it('writes why the model picked a record beside it, and nothing for a record with no reason', async () => {
        const [, explained] = await write({ ...record, pickedBecause: 'Something quiet after the news.' });
        const [, plain] = await write(record);

        expect(explained?.parameters).toContain('Something quiet after the news.');
        expect(plain?.parameters).not.toContain('Something quiet after the news.');
    });

    it('writes a break with its segment, and no source, since a record’s provenance is not a break’s', async () => {
        const [, insert] = await write(breakItem);

        expect(insert?.parameters).toEqual(expect.arrayContaining(['break', SEGMENT, 'Talk break: one into two']));
        expect(insert?.parameters).not.toContain('import');
    });

    it('writes a programme as one', async () => {
        const [, insert] = await write({ ...breakItem, programme: true });

        expect(insert?.parameters).toContain('programme');
    });
});

describe('AsRunRepository.close', () => {
    it('reaches only rows that started before it, open or ended after it', async () => {
        const captured: Captured[] = [];
        await new AsRunRepository(fakeDb(captured)).close('main', Date.UTC(2026, 9, 23, 20));

        const [close] = captured;
        expect(close?.sql).toContain('"aired_at" < to_timestamp(');
        expect(close?.sql).toContain('"ended_at" is null or "ended_at" > to_timestamp(');
        expect(close?.sql).toContain('greatest(aired_at, to_timestamp(');
    });
});
