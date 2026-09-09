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

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

const persona = (over: Partial<Persona> = {}): Persona => ({
    id: 'p1',
    key: 'pirate',
    kind: 'host',
    label: 'Pirate captain',
    style: 'a pirate captain who runs a radio station',
    active: false,
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
    sourcePluginId: 'spotify',
    sourcePlaylistId: 'playlist-1',
    records: [],
    transitions: 2,
    cursor: 0,
    state: 'queued',
    createdAt: Date.UTC(2026, 4, 12, 14, 30),
    ...over,
});

function build(options: { found?: Persona; tracks?: CatalogTrack[]; run?: Audition; rows?: unknown[]; cancelled?: boolean } = {}) {
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
    const tracks = { findByBindings } as never;

    const send = vi.fn(async () => {});
    const jobs = { send } as never;

    const record = vi.fn(async () => {});
    const activity = { record } as never;

    const context = { actor: { kind: 'user', actorId: 'actor-1' } } as never;

    const service = new PersonaAuditionService(auditions, personas, playlists, tracks, jobs, activity, context, logger as never);

    return { service, open, findById, listFor, breaksOf, cancel, prune, find, getPlaylistTracks, findByBindings, send, record };
}

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
