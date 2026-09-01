// The running order is written whole and read back through a hand-rolled reader, and the two halves
// of that serializer are the only thing standing between a restart and a different broadcast. What
// is pinned here is that EVERY field of every item survives the trip: for a long time `segmentKind`
// and `groupId` were written and never read, which turned each resume into an order where the
// bulletin was a station break and a production's beats were strangers to each other. The row is
// captured on the way out of `save` and handed straight back into `load`, so the test covers the
// shape the repository actually writes rather than one it was told about.

import { Kysely, PostgresDialect, DummyDriver } from 'kysely';
import type { DatabaseConnection, Dialect, Driver, QueryResult } from 'kysely';
import { KyselyDefaultPlugins } from '@maroonedsoftware/kysely';
import { describe, expect, it } from 'vitest';

import { StationLineupRepository } from '../../../src/modules/director/station.lineup.repository.js';
import { StationLineup, type StationLineupItem } from '../../../src/modules/director/station.lineup.js';
import type { DB } from '../../../src/modules/data/db.js';

interface Captured {
    sql?: string;
    parameters?: readonly unknown[];
}

/** A database that compiles the statement for real, records it, and answers with rows somebody chose. */
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

/** One of every kind of item the order can hold, every optional field set. */
const items = (): StationLineupItem[] => [
    {
        id: 'item-track',
        kind: 'track',
        state: 'played',
        track: {
            pluginId: 'spotify',
            externalId: 'ext-1',
            trackId: 'track-1',
            title: 'A Record',
            artist: 'Somebody',
            artists: ['Somebody', 'Somebody Else'],
            durationMs: 180_000,
            album: 'An Album',
            year: 1984,
        },
    },
    { id: 'item-break', kind: 'segment', state: 'planned', segmentId: 'seg-break' },
    { id: 'item-news', kind: 'segment', state: 'handed', segmentId: 'seg-news', segmentKind: 'news' },
    { id: 'item-cue', kind: 'segment', state: 'planned', segmentId: 'seg-cue', segmentKind: 'talk', over: { atMs: 4_500 } },
    { id: 'item-beat-1', kind: 'segment', state: 'planned', segmentId: 'seg-beat-1', segmentKind: 'production', groupId: 'episode-1' },
    { id: 'item-beat-2', kind: 'segment', state: 'planned', segmentId: 'seg-beat-2', segmentKind: 'production', groupId: 'episode-1' },
];

const lineup = () =>
    new StationLineup(
        {
            broadcastId: 'broadcast-1',
            name: 'Late Night',
            brief: 'slow records',
            eraFrom: 1970,
            eraTo: 1989,
            personaId: 'persona-1',
            slotId: 'slot-1',
            mode: 'rotation',
            onEnd: 'repeat',
            source: 'playlist',
            sourcePluginId: 'spotify',
            sourcePlaylistId: 'pl-1',
        },
        items(),
    );

/** Turn the parameters `save` sent into the row `load` would be handed for them. */
function rowFrom(captured: Captured): Record<string, unknown> {
    const sql = captured.sql ?? '';
    const parameters = captured.parameters ?? [];
    // `insert into ... ("station_key", "broadcast_id", ...) values ($1, $2, ...)`: the column list
    // and the parameter list line up one to one, which is what makes the row recoverable from the
    // statement alone.
    const columns =
        /\(([^)]+)\) values/
            .exec(sql)?.[1]
            ?.split(',')
            .map(column => column.trim().replace(/"/g, '')) ?? [];
    const row: Record<string, unknown> = {};
    columns.forEach((column, index) => {
        const camel = column.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
        const value = parameters[index];
        row[camel] = column === 'items' || column === 'rules' ? (typeof value === 'string' ? JSON.parse(value) : value) : value;
    });
    return row;
}

describe('StationLineupRepository round trip', () => {
    it('reads back every field of every item it wrote', async () => {
        const saved: Captured = {};
        await new StationLineupRepository(fakeDb([], saved)).save(lineup().toSnapshot());

        const loaded = await new StationLineupRepository(fakeDb([rowFrom(saved)], {})).load();

        expect(loaded?.toSnapshot()).toEqual(lineup().toSnapshot());
    });

    it('keeps a bulletin a bulletin and a production a block across the trip', async () => {
        const saved: Captured = {};
        await new StationLineupRepository(fakeDb([], saved)).save(lineup().toSnapshot());
        const loaded = await new StationLineupRepository(fakeDb([rowFrom(saved)], {})).load();

        const byId = new Map(loaded?.toSnapshot().items.map(item => [item.id, item]));
        expect(byId.get('item-news')).toMatchObject({ segmentKind: 'news' });
        expect(byId.get('item-beat-1')).toMatchObject({ groupId: 'episode-1' });
        expect(byId.get('item-beat-2')).toMatchObject({ groupId: 'episode-1' });
        // And an ordinary break carries neither: absent, not `undefined`, so the shape reaching the
        // planner is the codebase's own "not set" and never a third state.
        expect(byId.get('item-break')).not.toHaveProperty('segmentKind');
        expect(byId.get('item-break')).not.toHaveProperty('groupId');
    });

    it('drops a segment kind or group that is not a string rather than airing it', async () => {
        const row = {
            ...rowFrom(
                await (async () => {
                    const saved: Captured = {};
                    await new StationLineupRepository(fakeDb([], saved)).save(lineup().toSnapshot());
                    return saved;
                })(),
            ),
            items: [{ id: 'x', kind: 'segment', state: 'planned', segmentId: 'seg', segmentKind: 7, groupId: { nested: true } }],
        };

        const loaded = await new StationLineupRepository(fakeDb([row], {})).load();

        expect(loaded?.toSnapshot().items).toEqual([{ id: 'x', kind: 'segment', state: 'planned', segmentId: 'seg' }]);
    });
});
