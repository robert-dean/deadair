// What an edit to a slot throws away. A prepared set always goes, since it was chosen against the
// brief the edit replaced; where the slot got to in its playlist goes only when the edit changed which
// source the slot plays, since a renamed show is no reason to start a long playlist over.

import { Kysely, PostgresDialect, DummyDriver } from 'kysely';
import type { DatabaseConnection, Dialect, Driver, QueryResult } from 'kysely';
import { KyselyDefaultPlugins } from '@maroonedsoftware/kysely';
import { describe, expect, it } from 'vitest';

import { ScheduleRepository, type ScheduleSlotDraft } from '../../../src/modules/schedule/schedule.repository.js';
import { StationIdentity } from '../../../src/modules/shared/station.identity.js';
import type { DB } from '../../../src/modules/data/db.js';

const SLOT = '00000000-0000-4000-8000-0000000000aa';

/** The stored row an update hands back, with the source the case gives it. */
const storedRow = (source: Record<string, string | null>) => ({
    id: SLOT,
    label: 'Late night',
    startsAtMinutes: 1320,
    endsAtMinutes: 60,
    days: [],
    sourcePluginId: null,
    sourcePlaylistId: null,
    sourceChartId: null,
    sourceChartOrder: null,
    sourceStationPlaylistId: null,
    personaId: null,
    brief: '',
    eraFrom: null,
    eraTo: null,
    moods: null,
    avoidMoods: null,
    callins: null,
    mixInSimilar: null,
    chartPositions: null,
    breaks: null,
    requestShow: null,
    requestFollowOn: null,
    startsOn: null,
    endsOn: null,
    yearly: false,
    resumePlaylist: true,
    mode: 'setlist',
    onEnd: 'extend',
    ...source,
});

/**
 * A database that compiles every statement for real and answers the slot's row as it stood before the
 * edit to the first read, and as it stands after to the update. Everything else answers no rows.
 */
function fakeDb(before: Record<string, unknown>, after: Record<string, unknown>, statements: string[], parameters: unknown[][] = []): Kysely<DB> {
    const postgres = new PostgresDialect({ pool: {} as never });

    const connection: DatabaseConnection = {
        executeQuery: async compiled => {
            statements.push(compiled.sql);
            parameters.push([...compiled.parameters]);
            if (compiled.sql.startsWith('select') && compiled.sql.includes('"schedule_slots"')) return { rows: [before] } as QueryResult<never>;
            if (compiled.sql.startsWith('update')) return { rows: [after] } as QueryResult<never>;
            return { rows: [] } as QueryResult<never>;
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

const draft = (source: ScheduleSlotDraft['source']): ScheduleSlotDraft => ({
    label: 'Late night',
    startsAtMinutes: 1320,
    endsAtMinutes: 60,
    days: [],
    ...(source === undefined ? {} : { source }),
    resumePlaylist: true,
    mode: 'setlist',
    onEnd: 'extend',
});

const playlist = { sourcePluginId: 'deadair.spotify', sourcePlaylistId: 'pl_1' };

async function edit(before: Record<string, string | null>, after: Record<string, string | null>, source: ScheduleSlotDraft['source']) {
    const statements: string[] = [];
    const slot = await new ScheduleRepository(fakeDb(storedRow(before), storedRow(after), statements), new StationIdentity()).update(
        SLOT,
        draft(source),
    );
    return { slot, statements };
}

const clearsPosition = (statements: string[]) => statements.some(sql => sql.startsWith('delete from "deadair"."schedule_playlist_positions"'));

describe('ScheduleRepository.update', () => {
    it('forgets where the slot got to when the edit changes its playlist', async () => {
        const { statements } = await edit(playlist, { ...playlist, sourcePlaylistId: 'pl_2' }, { pluginId: 'deadair.spotify', playlistId: 'pl_2' });

        expect(clearsPosition(statements)).toBe(true);
    });

    it('forgets it when the slot moves from a provider playlist to a station playlist', async () => {
        const station = '00000000-0000-4000-8000-0000000000bb';
        const { statements } = await edit(
            playlist,
            { sourcePluginId: null, sourcePlaylistId: null, sourceStationPlaylistId: station },
            { stationPlaylistId: station },
        );

        expect(clearsPosition(statements)).toBe(true);
    });

    it('keeps it when the edit leaves the source alone, and still lets the prepared set go', async () => {
        const { slot, statements } = await edit(playlist, playlist, { pluginId: 'deadair.spotify', playlistId: 'pl_1' });

        expect(clearsPosition(statements)).toBe(false);
        expect(statements.some(sql => sql.startsWith('delete from "deadair"."schedule_prepared_sets"'))).toBe(true);
        expect(slot?.resumePlaylist).toBe(true);
    });

    it('writes resuming off for a slot whose source is not a playlist, whatever the draft says', async () => {
        const statements: string[] = [];
        const parameters: unknown[][] = [];
        const chart = { sourceChartId: 'deadair.lastfm:top' };
        const db = fakeDb(storedRow(chart), storedRow(chart), statements, parameters);
        await new ScheduleRepository(db, new StationIdentity()).update(SLOT, draft({ chartId: 'deadair.lastfm:top' }));

        const at = statements.findIndex(sql => sql.startsWith('update'));
        expect(statements[at]).toContain('"resume_playlist" = $');
        expect(parameters[at]).toContain(false);
        expect(parameters[at]).not.toContain(true);
    });
});
