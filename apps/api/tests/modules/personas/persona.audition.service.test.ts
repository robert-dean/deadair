// Starting an audition QUEUES it, and that is the whole shape of this service: it resolves the
// playlist, writes a row and sends one job. Every transition after that is a generation at the
// `preview` tier, so a request that wrote even the first break would hold a connection and a browser
// for the length of a model call — the console making the station worse by being looked at.
//
// The playlist is read HERE rather than in the job, and that is not an accident of layering:
// `PlaylistsService` is scoped over the access control the operator's session carries, and a job
// runs as nobody. Reading it in the request is also what makes a run a measurement, since a playlist
// reordered at the provider half way through cannot move what is being measured underneath it.

import { describe, expect, it, vi } from 'vitest';

import { PersonaAuditionService } from '../../../src/modules/personas/persona.audition.service.js';
import type { Audition } from '../../../src/modules/personas/persona.audition.js';
import type { CatalogTrack } from '../../../src/modules/playlists/types/playlists.types.js';
import type { Persona } from '../../../src/modules/personas/persona.js';
import type { StationPlaylistRowTrack } from '../../../src/modules/playlists/station.playlists.repository.js';
import type { ChartEntry } from '@deadair/plugin-sdk';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

const persona = (over: Partial<Persona> = {}): Persona => ({
    id: 'p1',
    key: 'pirate',
    kind: 'host',
    label: 'Pirate captain',
    style: 'a pirate captain who runs a radio station',
    defaultHost: false,
    ...over,
});

/** A provider's track, as `getPlaylistTracks` answers with one. */
const track = (id: string, over: Partial<CatalogTrack> = {}): CatalogTrack => ({
    id,
    title: `Song ${id}`,
    artists: ['Booker T. & the M.G.s', 'somebody else'],
    ...over,
});

const audition = (over: Partial<Audition> = {}): Audition => ({
    id: 'audition-1',
    stationKey: 'main',
    personaId: 'p1',
    personaKey: 'pirate',
    source: { pluginId: 'spotify', playlistId: 'playlist-1' },
    records: [],
    transitions: 2,
    cursor: 0,
    state: 'queued',
    createdAt: Date.UTC(2026, 4, 12, 14, 30),
    ...over,
});

/** A station playlist's row, as `StationPlaylistsRepository.tracks` answers with one. */
const owned = (id: string, over: Partial<StationPlaylistRowTrack> = {}): StationPlaylistRowTrack => ({
    id,
    position: 0,
    title: `Owned ${id}`,
    artists: ['Bill Withers', 'somebody else'],
    ...over,
});

/** A chart's entry, as `ChartsService.fetchChart` answers with one. */
const entry = (rank: number, over: Partial<ChartEntry> = {}): ChartEntry => ({ rank, title: `Hit ${rank}`, artist: `Artist ${rank}`, ...over });

function build(
    options: {
        found?: Persona;
        tracks?: CatalogTrack[];
        run?: Audition;
        rows?: unknown[];
        cancelled?: boolean;
        stationPlaylist?: { id: string; name: string } | undefined;
        stationRows?: StationPlaylistRowTrack[];
        chart?: ChartEntry[];
        matches?: Record<string, string>;
        catalog?: Map<string, { year?: number; album?: string }>;
    } = {},
) {
    const open = vi.fn(async (input: { records: readonly unknown[] }) => audition({ transitions: input.records.length - 1 }));
    const findById = vi.fn(async () => ('run' in options ? options.run : audition()));
    const listFor = vi.fn(async () => [audition()]);
    const breaksOf = vi.fn(async () => []);
    const writtenCount = vi.fn(async () => 0);
    const cancel = vi.fn(async () => options.cancelled ?? true);
    const prune = vi.fn(async () => 0);
    const auditions = { open, findById, listFor, breaksOf, writtenCount, cancel, prune } as never;

    const find = vi.fn(async () => ('found' in options ? options.found : persona()));
    const personas = { find } as never;

    const getPlaylistTracks = vi.fn(async () => ({
        pluginId: 'spotify',
        playlistId: 'playlist-1',
        tracks: options.tracks ?? [track('a'), track('b'), track('c')],
    }));
    const playlists = { getPlaylistTracks } as never;

    const findByBindings = vi.fn(async () => options.rows ?? []);
    const findByIds = vi.fn(async () => options.catalog ?? new Map());
    const tracks = { findByBindings, findByIds } as never;

    const findStationPlaylist = vi.fn(async () => ('stationPlaylist' in options ? options.stationPlaylist : { id: 'owned-1', name: 'Sunday soul' }));
    const stationTracks = vi.fn(async () => options.stationRows ?? [owned('a'), owned('b'), owned('c')]);
    const stationPlaylists = { find: findStationPlaylist, tracks: stationTracks } as never;

    const fetchChart = vi.fn(async () => options.chart ?? [entry(1), entry(2), entry(3)]);
    const charts = { fetchChart } as never;

    const findByName = vi.fn(async (title: string) => {
        const trackId = options.matches?.[title];
        return trackId === undefined ? undefined : { trackId, title, artist: 'x' };
    });
    const candidates = { findByName } as never;

    const send = vi.fn(async () => {});
    const jobs = { send } as never;

    const record = vi.fn(async () => {});
    const activity = { record } as never;

    const context = { actor: { kind: 'user', actorId: 'actor-1' } } as never;

    const service = new PersonaAuditionService(
        auditions,
        personas,
        playlists,
        tracks,
        stationPlaylists,
        charts,
        candidates,
        jobs,
        activity,
        context,
        logger as never,
    );

    return {
        service,
        open,
        findById,
        listFor,
        breaksOf,
        cancel,
        prune,
        find,
        getPlaylistTracks,
        findByBindings,
        findByIds,
        stationTracks,
        fetchChart,
        send,
        record,
    };
}

describe('PersonaAuditionService.start: which source', () => {
    it('refuses a request that names no source', async () => {
        const { service, open } = build();

        await expect(service.start('p1', { limit: 10 })).rejects.toMatchObject({ statusCode: 422 });
        expect(open).not.toHaveBeenCalled();
    });

    it('refuses a request that names two', async () => {
        // Which one wins would be a decision the station made for the operator.
        const { service, getPlaylistTracks, fetchChart } = build();

        await expect(service.start('p1', { pluginId: 'spotify', playlistId: 'playlist-1', chartId: 'lastfm:top', limit: 10 })).rejects.toMatchObject({
            statusCode: 422,
        });
        expect(getPlaylistTracks).not.toHaveBeenCalled();
        expect(fetchChart).not.toHaveBeenCalled();
    });

    it('refuses half of a provider playlist', async () => {
        const { service } = build();

        await expect(service.start('p1', { pluginId: 'spotify', limit: 10 })).rejects.toMatchObject({ statusCode: 422 });
    });
});

describe('PersonaAuditionService.start: a station playlist', () => {
    it('reads its rows, placeholders included, and records it as the source', async () => {
        // A broadcast leaves a placeholder out because it cannot fetch one; an audition fetches
        // nothing, and a record the library does not hold yet is still one a host can introduce.
        const { service, open, getPlaylistTracks } = build({ stationRows: [owned('a', { trackId: 't1' }), owned('b')] });

        await service.start('p1', { stationPlaylistId: 'owned-1', limit: 10 });

        expect(getPlaylistTracks).not.toHaveBeenCalled();
        const input = open.mock.calls[0]![0] as unknown as {
            source: unknown;
            sourceName?: string;
            records: { title: string; artist: string; trackId?: string }[];
        };
        expect(input.source).toEqual({ stationPlaylistId: 'owned-1' });
        expect(input.records.map(record => record.title)).toEqual(['Owned a', 'Owned b']);
        expect(input.records[0]).toMatchObject({ artist: 'Bill Withers', trackId: 't1' });
        expect(input.records[1]).not.toHaveProperty('trackId');
    });

    it('takes its name as the caption when the console sent none', async () => {
        const { service, open } = build();

        await service.start('p1', { stationPlaylistId: 'owned-1', limit: 10 });

        expect((open.mock.calls[0]![0] as unknown as { sourceName?: string }).sourceName).toBe('Sunday soul');
    });

    it('adds the year the catalog holds', async () => {
        const { service, open } = build({
            stationRows: [owned('a', { trackId: 't1' }), owned('b')],
            catalog: new Map([['t1', { year: 1971, album: 'Just As I Am' }]]),
        });

        await service.start('p1', { stationPlaylistId: 'owned-1', limit: 10 });

        const [first] = (open.mock.calls[0]![0] as unknown as { records: { year?: number; album?: string }[] }).records;
        expect(first).toMatchObject({ year: 1971, album: 'Just As I Am' });
    });

    it('answers 404 for one the station does not hold', async () => {
        const { service, open } = build({ stationPlaylist: undefined });

        await expect(service.start('p1', { stationPlaylistId: 'gone', limit: 10 })).rejects.toMatchObject({ statusCode: 404 });
        expect(open).not.toHaveBeenCalled();
    });

    it('takes one more row than the breaks asked for', async () => {
        const { service, open } = build({ stationRows: ['a', 'b', 'c', 'd', 'e'].map(id => owned(id)) });

        await service.start('p1', { stationPlaylistId: 'owned-1', limit: 2 });

        expect((open.mock.calls[0]![0] as unknown as { records: unknown[] }).records).toHaveLength(3);
    });
});

describe('PersonaAuditionService.start: a chart', () => {
    it('reads it from the top, whatever order the plugin answered in', async () => {
        const { service, open, fetchChart } = build({ chart: [entry(3), entry(1), entry(2)] });

        await service.start('p1', { chartId: 'lastfm:top', limit: 10 });

        expect(fetchChart).toHaveBeenCalledWith('lastfm:top', 11);
        const input = open.mock.calls[0]![0] as unknown as { source: unknown; records: { title: string }[] };
        expect(input.source).toEqual({ chartId: 'lastfm:top' });
        expect(input.records.map(record => record.title)).toEqual(['Hit 1', 'Hit 2', 'Hit 3']);
    });

    it('matches an entry the library holds, and keeps one it does not', async () => {
        // Never looked up at a provider: nothing in an audition airs, so nothing needs a copy.
        const { service, open } = build({ chart: [entry(1, { year: 1999 }), entry(2)], matches: { 'Hit 1': 't1' } });

        await service.start('p1', { chartId: 'lastfm:top', limit: 10 });

        const records = (open.mock.calls[0]![0] as unknown as { records: { trackId?: string; year?: number }[] }).records;
        expect(records[0]).toMatchObject({ trackId: 't1', year: 1999 });
        expect(records[1]).not.toHaveProperty('trackId');
    });

    it('refuses an id that names no chart before asking anything', async () => {
        const { service, fetchChart } = build();

        await expect(service.start('p1', { chartId: 'nocolon', limit: 10 })).rejects.toMatchObject({ statusCode: 422 });
        expect(fetchChart).not.toHaveBeenCalled();
    });

    it('refuses a chart nothing could read', async () => {
        // `ChartsService` answers every failure with an empty list.
        const { service, open } = build({ chart: [] });

        await expect(service.start('p1', { chartId: 'lastfm:top', limit: 10 })).rejects.toMatchObject({ statusCode: 422 });
        expect(open).not.toHaveBeenCalled();
    });
});

describe('PersonaAuditionService.start', () => {
    it('refuses a character that does not exist', async () => {
        const { service, getPlaylistTracks } = build({ found: undefined });

        await expect(service.start('nobody', { pluginId: 'spotify', playlistId: 'playlist-1', limit: 10 })).rejects.toMatchObject({
            statusCode: 404,
        });
        // Nothing is read from the provider for a run that cannot exist.
        expect(getPlaylistTracks).not.toHaveBeenCalled();
    });

    it('refuses a playlist with nothing to write a break between', async () => {
        // A break sits BETWEEN two records, so one record has no transition. An empty run reported
        // as `done` would be a measurement that never happened.
        const { service, open, send } = build({ tracks: [track('a')] });

        await expect(service.start('p1', { pluginId: 'spotify', playlistId: 'playlist-1', limit: 10 })).rejects.toMatchObject({ statusCode: 422 });
        expect(open).not.toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
    });

    it('takes one more record than the breaks asked for', async () => {
        const { service, open } = build({ tracks: ['a', 'b', 'c', 'd', 'e', 'f'].map(id => track(id)) });

        await service.start('p1', { pluginId: 'spotify', playlistId: 'playlist-1', limit: 3 });

        // Three breaks need four records.
        expect(open.mock.calls[0]?.[0].records).toHaveLength(4);
    });

    it('reads the playlist as the operator, in the request', async () => {
        const { service, getPlaylistTracks } = build();

        await service.start('p1', { pluginId: 'spotify', playlistId: 'playlist-1', limit: 10 });

        expect(getPlaylistTracks).toHaveBeenCalledWith('spotify', 'playlist-1');
    });

    it('stores the lead artist rather than the whole credit line', async () => {
        const { service, open } = build();

        await service.start('p1', { pluginId: 'spotify', playlistId: 'playlist-1', limit: 10 });

        // A provider's array really does have the lead first, which is not true of the catalog's own
        // credit column.
        const [first] = open.mock.calls[0]![0].records as { artist: string }[];
        expect(first?.artist).toBe('Booker T. & the M.G.s');
    });

    it('carries what the catalog knows about the records it holds', async () => {
        const { service, open } = build({
            tracks: [track('a', { trackId: 't1' }), track('b')],
            rows: [{ externalId: 'a', trackId: 't1', year: 1962, albumName: 'Green Onions' }],
        });

        await service.start('p1', { pluginId: 'spotify', playlistId: 'playlist-1', limit: 10 });

        const records = open.mock.calls[0]![0].records as { trackId?: string; year?: number; album?: string }[];
        // The id is what the facts, the year and the album all hang off.
        expect(records[0]).toMatchObject({ trackId: 't1', year: 1962, album: 'Green Onions' });
        // And a record the station has never seen is an ordinary record with less to say.
        expect(Object.keys(records[1]!)).not.toContain('trackId');
    });

    it('runs anyway when the catalog read fails', async () => {
        const { service, open, findByBindings } = build();
        findByBindings.mockRejectedValueOnce(new Error('the database is unreachable'));

        await service.start('p1', { pluginId: 'spotify', playlistId: 'playlist-1', limit: 10 });

        // Best-effort, on `toRundownTracks`' rule: what it adds is metadata, and a run without it is
        // an audition with less in front of the writers rather than no audition.
        expect(open).toHaveBeenCalled();
    });

    it('queues the first transition rather than writing it', async () => {
        const { service, send } = build();

        const started = await service.start('p1', { pluginId: 'spotify', playlistId: 'playlist-1', limit: 10 });

        expect(send).toHaveBeenCalledWith('personas.audition', { auditionId: 'audition-1', ordinal: 0 });
        // The answer comes back within a request while the run itself takes minutes, so it says
        // plainly that nothing has been written yet.
        expect(started.state).toBe('queued');
        expect(started.breaks).toEqual([]);
        expect(started.written).toBe(0);
    });

    it('keeps the run bounded rather than sweeping it later', async () => {
        const { service, prune } = build();

        await service.start('p1', { pluginId: 'spotify', playlistId: 'playlist-1', limit: 10 });

        expect(prune).toHaveBeenCalledWith('p1', 29);
    });

    it('says so in the activity feed, under the module an operator filters by', async () => {
        const { service, record } = build();

        await service.start('p1', { pluginId: 'spotify', playlistId: 'playlist-1', limit: 10 });

        expect(record).toHaveBeenCalledWith(expect.objectContaining({ module: 'director', kind: 'persona.audition.started', actorId: 'actor-1' }));
    });
});

describe('PersonaAuditionService.get', () => {
    it('refuses a run belonging to a different character', async () => {
        // Otherwise one character's breaks are drawn under another's name.
        const { service } = build({ run: audition({ personaId: 'somebody-else' }) });

        await expect(service.get('p1', 'audition-1')).rejects.toMatchObject({ statusCode: 404 });
    });

    it('answers the run with its breaks in order', async () => {
        const { service, breaksOf } = build();
        breaksOf.mockResolvedValueOnce([
            {
                id: 'b1',
                auditionId: 'audition-1',
                ordinal: 0,
                previous: { pluginId: 'spotify', externalId: 'a', title: 'Green Onions', artist: 'Booker T.', trackId: 't1' },
                next: { pluginId: 'spotify', externalId: 'b', title: "Ain't No Sunshine", artist: 'Bill Withers' },
                attempts: [{ writer: 'model', outcome: 'written', durationMs: 900, script: 'That was Green Onions.' }],
                script: 'That was Green Onions.',
                writer: 'model',
                createdAt: 0,
            },
        ] as never);

        const run = await service.get('p1', 'audition-1');

        expect(run.breaks).toHaveLength(1);
        expect(run.breaks[0]).toMatchObject({ ordinal: 0, script: 'That was Green Onions.', writer: 'model' });
        // The binding is the station's own bookkeeping and has no business in a console payload.
        expect(Object.keys(run.breaks[0]!.previous)).not.toContain('externalId');
        expect(run.breaks[0]?.previous.trackId).toBe('t1');
        // How far along it is comes from the breaks that are already there rather than a second read.
        expect(run.written).toBe(1);
    });
});

describe('PersonaAuditionService.get: the source', () => {
    it('answers each kind of source as the one it was, with its caption', async () => {
        for (const source of [{ pluginId: 'spotify', playlistId: 'playlist-1' }, { stationPlaylistId: 'owned-1' }, { chartId: 'lastfm:top' }]) {
            const { service } = build({ run: audition({ source, sourceName: 'Sunday soul' }) });

            const run = await service.get('p1', 'audition-1');

            // Only the ids of the one it was: a console tells the kinds apart by which is present.
            expect(run.source).toEqual({ ...source, name: 'Sunday soul' });
        }
    });
});

describe('PersonaAuditionService.cancel', () => {
    it('stops a run that is still going', async () => {
        const { service, cancel, record } = build();

        await service.cancel('p1', 'audition-1');

        expect(cancel).toHaveBeenCalledWith('audition-1');
        expect(record).toHaveBeenCalledWith(expect.objectContaining({ kind: 'persona.audition.cancelled' }));
    });

    it('refuses one that has already settled', async () => {
        // Stopping something that finished would rewrite the record into saying it never did.
        const { service } = build({ run: audition({ state: 'done' }), cancelled: false });

        await expect(service.cancel('p1', 'audition-1')).rejects.toMatchObject({ statusCode: 409 });
    });
});

describe('PersonaAuditionService.list', () => {
    it('answers this character’s runs without their breaks', async () => {
        const { service, breaksOf } = build();

        const listed = await service.list('p1');

        expect(listed.auditions).toHaveLength(1);
        // A list page showing twenty runs must not read every break of every one to draw them.
        expect(breaksOf).not.toHaveBeenCalled();
    });

    it('refuses a character that does not exist', async () => {
        const { service } = build({ found: undefined });

        await expect(service.list('nobody')).rejects.toMatchObject({ statusCode: 404 });
    });
});
