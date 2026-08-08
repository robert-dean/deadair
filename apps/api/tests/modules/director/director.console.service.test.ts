// The operator's side. Two things matter here: an import must carry through
// everything the catalog knows about a track without ever failing the import over
// it, and every refusal an edit can produce has to arrive as the status code that
// says the same thing, because a console has to tell someone standing at the desk
// why nothing happened.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';
import type { JobBroker } from '@maroonedsoftware/jobbroker';

import { DirectorConsoleService } from '../../../src/modules/director/director.console.service.js';
import type { DirectorService } from '../../../src/modules/director/director.service.js';
import { Lineup } from '../../../src/modules/director/lineup.js';
import type { LineupRepository, NewLineup } from '../../../src/modules/director/lineup.repository.js';
import type { StationAirRepository } from '../../../src/modules/director/station.air.repository.js';
import type { TracksRepository } from '../../../src/modules/catalog/tracks.repository.js';
import type { PlaylistsService } from '../../../src/modules/playlists/playlists.service.js';
import type { Rundown, RundownTrack } from '../../../src/modules/playout/rundown.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

interface Options {
    tracks?: { id: string; title: string; artists: string[]; durationMs?: number; album?: string; artworkUrl?: string }[];
    playlistError?: Error;
    catalogRows?: { externalId: string; trackId: string; year: number | null; albumName: string | null; albumImageUrl: string | null }[];
    catalogError?: Error;
    /** What the director says it is airing. */
    onAir?: { lineupId?: string; cursor?: number };
    existing?: RundownTrack[];
    missing?: boolean;
}

function build(options: Options = {}) {
    const lineup = new Lineup({ id: 'lineup-1', name: 'Afternoons', mode: 'rotation', onEnd: 'extend', source: 'import' });

    let created: NewLineup | undefined;
    const lineups = {
        list: vi.fn(async () => [{ id: 'lineup-1', name: 'Afternoons' }]),
        load: vi.fn(async (id: string) => (options.missing || id !== 'lineup-1' ? undefined : lineup)),
        create: vi.fn(async (input: NewLineup) => {
            created = input;
            const made = new Lineup({ id: 'lineup-2', name: input.name, mode: 'rotation', onEnd: 'extend', source: 'import' });
            if (input.tracks) await made.append(input.tracks);
            return made;
        }),
        remove: vi.fn(async () => {}),
    } as unknown as LineupRepository;

    const air = {
        putOnAir: vi.fn(async () => {}),
        forgetLineup: vi.fn(async () => {}),
    } as unknown as StationAirRepository;

    const director = {
        status: vi.fn(() => ({ active: true, cursor: options.onAir?.cursor ?? 0, remaining: 0, ...options.onAir })),
        reload: vi.fn(async () => {}),
    } as unknown as DirectorService;

    const playlists = {
        getPlaylistTracks: vi.fn(async () => {
            if (options.playlistError) throw options.playlistError;
            return {
                pluginId: 'deadair.spotify',
                playlistId: 'pl_1',
                tracks: options.tracks ?? [{ id: 'trk_1', title: 'A Track', artists: ['An Artist'] }],
            };
        }),
    } as unknown as PlaylistsService;

    const tracks = {
        findByBindings: vi.fn(async () => {
            if (options.catalogError) throw options.catalogError;
            return options.catalogRows ?? [];
        }),
    } as unknown as TracksRepository;

    const rundown = { load: vi.fn() } as unknown as Rundown;
    const jobs = { send: vi.fn(async () => 'job-1') } as unknown as JobBroker;

    return {
        service: new DirectorConsoleService(lineups, air, director, playlists, tracks, rundown, jobs, logger),
        lineup,
        lineups,
        air,
        director,
        rundown,
        jobs,
        tracks,
        createdWith: () => created,
        seed: async () => (options.existing ? lineup.append(options.existing) : undefined),
    };
}

const statusOf = async (call: Promise<unknown>): Promise<number> => {
    try {
        await call;
        return 200;
    } catch (error) {
        return (error as { status?: number; statusCode?: number }).status ?? (error as { statusCode?: number }).statusCode ?? 0;
    }
};

beforeEach(() => {
    vi.clearAllMocks();
});

describe('DirectorConsoleService.importPlaylist', () => {
    it('builds a lineup from the playlist and remembers where it came from', async () => {
        const { service, createdWith } = build();

        await service.importPlaylist({ pluginId: 'deadair.spotify', playlistId: 'pl_1', name: 'Discover Weekly' });

        expect(createdWith()).toMatchObject({ name: 'Discover Weekly', source: 'import', sourcePluginId: 'deadair.spotify', sourcePlaylistId: 'pl_1' });
    });

    it('keeps what the provider says about the copy it will actually serve', async () => {
        // The provider describes the thing that will play. The catalog describes the
        // work, and must not overwrite the album printed on the copy being aired.
        const { service, createdWith } = build({
            tracks: [{ id: 'trk_9', title: 'B Side', artists: ['Someone'], album: 'The Single' }],
            catalogRows: [{ externalId: 'trk_9', trackId: 'cat-1', year: 1979, albumName: 'The Album', albumImageUrl: null }],
        });

        await service.importPlaylist({ pluginId: 'deadair.spotify', playlistId: 'pl_1' });

        expect(createdWith()?.tracks?.[0]).toMatchObject({ album: 'The Single', year: 1979, trackId: 'cat-1' });
    });

    it('takes the catalog cover over the provider one, because it may already be cached locally', async () => {
        const { service, createdWith } = build({
            tracks: [{ id: 'trk_9', title: 'B Side', artists: ['Someone'], artworkUrl: 'https://provider.test/cover.jpg' }],
            catalogRows: [{ externalId: 'trk_9', trackId: 'cat-1', year: null, albumName: null, albumImageUrl: 'art/asset-1' }],
        });

        await service.importPlaylist({ pluginId: 'deadair.spotify', playlistId: 'pl_1' });

        expect(createdWith()?.tracks?.[0]).toMatchObject({ artworkUrl: 'art/asset-1' });
    });

    it('falls back to the provider cover for a track the catalog has never seen', async () => {
        const { service, createdWith } = build({
            tracks: [{ id: 'trk_9', title: 'B Side', artists: ['Someone'], artworkUrl: 'https://provider.test/cover.jpg' }],
            catalogRows: [],
        });

        await service.importPlaylist({ pluginId: 'deadair.spotify', playlistId: 'pl_1' });

        expect(createdWith()?.tracks?.[0]).toEqual({
            pluginId: 'deadair.spotify',
            externalId: 'trk_9',
            title: 'B Side',
            artists: ['Someone'],
            artworkUrl: 'https://provider.test/cover.jpg',
        });
    });

    it('imports anyway when the catalog read fails', async () => {
        // Metadata is decoration; airing is the job.
        const { service, createdWith } = build({ catalogError: new Error('the pool is gone') });

        await service.importPlaylist({ pluginId: 'deadair.spotify', playlistId: 'pl_1' });

        expect(createdWith()?.tracks).toHaveLength(1);
    });

    it('asks the catalog once for the whole playlist', async () => {
        const { service, tracks } = build({
            tracks: [
                { id: 'trk_1', title: 'One', artists: ['A'] },
                { id: 'trk_2', title: 'Two', artists: ['B'] },
            ],
        });

        await service.importPlaylist({ pluginId: 'deadair.spotify', playlistId: 'pl_1' });

        expect(tracks.findByBindings).toHaveBeenCalledOnce();
        expect(tracks.findByBindings).toHaveBeenCalledWith('deadair.spotify', ['trk_1', 'trk_2']);
    });

    it('refuses an empty playlist rather than making a lineup that airs silence', async () => {
        const { service, lineups } = build({ tracks: [] });

        expect(await statusOf(service.importPlaylist({ pluginId: 'deadair.spotify', playlistId: 'pl_1' }))).toBe(422);
        expect(lineups.create).not.toHaveBeenCalled();
    });

    it('lets the playlists read own the plugin narrowing', async () => {
        const forbidden = Object.assign(new Error('Forbidden'), { status: 403 });
        const { service } = build({ playlistError: forbidden });

        expect(await statusOf(service.importPlaylist({ pluginId: 'deadair.spotify', playlistId: 'pl_1' }))).toBe(403);
    });
});

describe('DirectorConsoleService.putOnAir', () => {
    it('retracts the tail of the previous lineup and tells the director at once', async () => {
        // What is ON AIR is left alone by `load`; only the uncommitted tail goes, so
        // changing programming does not cut a listener off mid-track.
        const { service, rundown, director } = build();

        await service.putOnAir({ lineupId: 'lineup-1' });

        expect(rundown.load).toHaveBeenCalledWith([]);
        expect(director.reload).toHaveBeenCalled();
    });

    it('remembers what it displaced only when it is interrupting', async () => {
        // An album feature hands the station back afterwards; an operator changing
        // programming has nothing to go back to.
        const { service, air } = build({ onAir: { lineupId: 'lineup-9', cursor: 12 } });

        await service.putOnAir({ lineupId: 'lineup-1', interrupting: true });
        expect(air.putOnAir).toHaveBeenCalledWith('lineup-1', { lineupId: 'lineup-9', cursor: 12 });

        await service.putOnAir({ lineupId: 'lineup-1' });
        expect(air.putOnAir).toHaveBeenLastCalledWith('lineup-1', undefined);
    });

    it('refuses a lineup that does not exist', async () => {
        const { service } = build({ missing: true });

        expect(await statusOf(service.putOnAir({ lineupId: 'lineup-1' }))).toBe(404);
    });
});

describe('DirectorConsoleService editing', () => {
    it('maps a stale revision onto a conflict', async () => {
        // The console drew a list and the operator acted on it; the director has
        // appended since. Re-read and try again is the only honest answer.
        const { service, seed, lineup } = build({ existing: [{ pluginId: 'p', externalId: 'a', title: 'A', artists: ['One'] }] });
        await seed();

        expect(await statusOf(service.removeItem('lineup-1', lineup.all()[0]!.id, { revision: 99 }))).toBe(409);
    });

    it('maps an unknown line onto a not-found', async () => {
        const { service, seed } = build({ existing: [{ pluginId: 'p', externalId: 'a', title: 'A', artists: ['One'] }] });
        await seed();

        expect(await statusOf(service.removeItem('lineup-1', 'nope', {}))).toBe(404);
    });

    it('maps a shuffle with nothing left onto an unprocessable request', async () => {
        const { service } = build();

        expect(await statusOf(service.shuffleLineup('lineup-1', {}))).toBe(422);
    });

    it('queues an extend rather than making the operator wait for it', async () => {
        // Generating walks the catalog and, later, rate-limited providers. A button
        // press should not hold a connection open through that.
        const { service, jobs } = build();

        await service.extendLineup('lineup-1', { count: 20 });

        expect(jobs.send).toHaveBeenCalledWith('director.extend_lineup', { lineupId: 'lineup-1', count: 20 });
    });
});

describe('DirectorConsoleService.remove', () => {
    it('refuses to delete what is on air', async () => {
        // Deleting what a listener is hearing is almost never what someone means, and
        // stopping the station is a separate decision they can make explicitly.
        const { service, lineups } = build({ onAir: { lineupId: 'lineup-1' } });

        expect(await statusOf(service.deleteLineup('lineup-1'))).toBe(409);
        expect(lineups.remove).not.toHaveBeenCalled();
    });

    it('deletes one that is not, and clears any pointer to it', async () => {
        const { service, lineups, air } = build({ onAir: { lineupId: 'lineup-9' } });

        await service.deleteLineup('lineup-1');

        expect(lineups.remove).toHaveBeenCalledWith('lineup-1');
        expect(air.forgetLineup).toHaveBeenCalledWith('lineup-1');
    });
});
