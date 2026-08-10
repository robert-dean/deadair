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
import type { AfterCommit } from '../../../src/modules/data/after.commit.js';
import type { RundownTrack } from '../../../src/modules/playout/rundown.js';
import type { Segment, SegmentRepository } from '../../../src/modules/render/segment.repository.js';
import type { SettingsService } from '../../../src/modules/settings/settings.service.js';
import { AIR_MODE_KEY } from '../../../src/modules/playout/air.mode.js';

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
    /** What the segment library holds, for the lines a lineup names by id. */
    segments?: Partial<Segment>[];
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
        status: vi.fn(() => ({ active: true, airMode: 'audience', cursor: options.onAir?.cursor ?? 0, remaining: 0, ...options.onAir })),
        reload: vi.fn(async () => {}),
        invalidate: vi.fn(),
        post: vi.fn(async () => {}),
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

    // Read-only from the console's side: a lineup names a segment and the library owns it.
    const library = new Map((options.segments ?? []).map(segment => [segment.id, segment as Segment]));
    const segments = {
        findById: vi.fn(async (id: string) => library.get(id)),
        findByIds: vi.fn(async (ids: readonly string[]) => new Map([...library].filter(([id]) => ids.includes(id)))),
    } as unknown as SegmentRepository;

    const settings = { set: vi.fn(async () => {}) } as unknown as SettingsService;
    // Runs the deferred task straight away, which is what the real one does relative to everything
    // this file asserts on: `AfterCommit` fires before the response is written.
    const deferred: (() => Promise<void>)[] = [];
    const afterCommit = {
        add: vi.fn((task: () => Promise<void>) => {
            deferred.push(task);
        }),
    } as unknown as AfterCommit;
    const settle = async () => {
        for (const task of deferred.splice(0)) await task();
    };
    const jobs = { send: vi.fn(async () => 'job-1') } as unknown as JobBroker;

    return {
        service: new DirectorConsoleService(lineups, air, director, playlists, tracks, segments, settings, afterCommit, jobs, logger),
        segments,
        settings,
        lineup,
        lineups,
        air,
        director,
        afterCommit,
        settle,
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

        expect(createdWith()).toMatchObject({
            name: 'Discover Weekly',
            source: 'import',
            sourcePluginId: 'deadair.spotify',
            sourcePlaylistId: 'pl_1',
        });
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

describe('DirectorConsoleService.setAirMode', () => {
    it('stores the mode, and tells nothing, because nothing has to be told', async () => {
        const { service, settings, director } = build();

        const air = await service.setAirMode({ airMode: 'always' });

        expect(settings.set).toHaveBeenCalledWith(AIR_MODE_KEY, 'always');
        // The mode is a setting, the settings table is a layer of the app's config, and the
        // transport asks the audience gate for it on every reconcile. There is nothing left here
        // to push it into, and nothing to re-read: a re-read would be wrong anyway, because this
        // runs inside the request's own uncommitted transaction.
        expect(director.reload).not.toHaveBeenCalled();
        expect(director.invalidate).not.toHaveBeenCalled();
    });

    it('answers with the mode just written, not the one the config still reports', async () => {
        // The config refreshes after this request COMMITS (see `SettingsService.set`), which is
        // necessarily after this method has built its answer. Reading it back here would hand the
        // console the mode the operator has just replaced, and the console would render it.
        const { service } = build();

        const air = await service.setAirMode({ airMode: 'always' });

        expect(air.airMode).toBe('always');
    });
});

describe('DirectorConsoleService.putOnAir', () => {
    it('cancels the reactor at once and hands it the change after the commit', async () => {
        // The two halves need different timing. A pass may already be gathering against the plan
        // this request just replaced, and only the epoch reaches that pass: a command runs AFTER
        // it, by which time the stale decision has been applied. The command is deferred because
        // the reactor reads on its own connection and cannot see this write until it commits.
        const { service, director, settle } = build();

        await service.putOnAir({ lineupId: 'lineup-1' });

        expect(director.invalidate).toHaveBeenCalled();
        expect(director.post).not.toHaveBeenCalled();

        await settle();

        expect(director.post).toHaveBeenCalledWith({ kind: 'putOnAir' });
    });

    it('answers with what it wrote, not with the lineup it just replaced', async () => {
        // The reactor has not acted on the row yet, so reading it back through `status()` here
        // answers with the previous lineup and the console renders the change as not having
        // happened.
        const { service } = build({ onAir: { lineupId: 'lineup-9', cursor: 12 } });

        const air = await service.putOnAir({ lineupId: 'lineup-1' });

        expect(air.lineupId).toBe('lineup-1');
        expect(air.cursor).toBe(0);
        expect(air.active).toBe(true);
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

// An operator putting a specific ident into the order. The load-bearing decision is that a segment
// with no audio is refused HERE rather than accepted and skipped at the boundary: the station's own
// planting can afford to be optimistic, but somebody who asked for this ident by name should be
// told why it will not play.
describe('DirectorConsoleService.addSegment', () => {
    const READY = { id: 'seg-1', kind: 'ident', state: 'ready' as const, label: 'Top of the hour', source: 'library' };

    it('puts a ready segment into the order and answers with the lineup', async () => {
        const { service, seed } = build({ segments: [READY], existing: [{ pluginId: 'p', externalId: 'a', title: 'A', artists: ['X'] }] });
        await seed();

        const lineup = await service.addSegment('lineup-1', { segmentId: 'seg-1', atIndex: 1 });

        expect(lineup.items[1]).toMatchObject({ kind: 'segment', segmentId: 'seg-1', title: 'Top of the hour', playable: true });
    });

    it('404s a segment the library does not have', async () => {
        const { service } = build({ segments: [] });

        expect(await statusOf(service.addSegment('lineup-1', { segmentId: 'seg-1' }))).toBe(404);
    });

    it('422s one that has no audio yet, rather than planting a line the station will skip', async () => {
        const { service } = build({ segments: [{ id: 'seg-1', kind: 'talkbreak', state: 'planned', label: 'A talk break', source: 'render' }] });

        expect(await statusOf(service.addSegment('lineup-1', { segmentId: 'seg-1' }))).toBe(422);
    });

    it('409s an insert made against an order that has moved', async () => {
        const { service, seed } = build({ segments: [READY] });
        await seed();

        expect(await statusOf(service.addSegment('lineup-1', { segmentId: 'seg-1', revision: 99 }))).toBe(409);
    });
});

// A lineup line names a segment by id and nothing else, so everything a console draws about it is
// read from the library. That is what makes a renamed segment read correctly against every lineup
// that plays it, and a segment that has lost its audio read as one the station will skip.
describe('DirectorConsoleService reading a lineup with segments', () => {
    it('fills a segment line in from the library', async () => {
        const { service, lineup, seed } = build({
            segments: [{ id: 'seg-1', kind: 'ident', state: 'ready', label: 'Top of the hour', source: 'library', durationMs: 4000 }],
        });
        await seed();
        await lineup.insertSegment('seg-1', 0);

        const drawn = await service.getLineup('lineup-1');

        expect(drawn.items[0]).toMatchObject({ kind: 'segment', title: 'Top of the hour', durationMs: 4000, playable: true, artists: [] });
    });

    // Drawn as itself rather than hidden: the lineup does hold the line and the station will pass
    // over it, and hiding it would leave an operator wondering why what they see is not what they
    // hear.
    it('draws a line whose segment is gone as one that will be skipped', async () => {
        const { service, lineup, seed } = build({ segments: [] });
        await seed();
        await lineup.insertSegment('seg-1', 0);

        const drawn = await service.getLineup('lineup-1');

        expect(drawn.items[0]).toMatchObject({ kind: 'segment', segmentState: 'gone', playable: false });
    });

    it('asks the library once for the whole order', async () => {
        const { service, segments, lineup, seed } = build({ segments: [] });
        await seed();
        await lineup.insertSegment('seg-1', 0);
        await lineup.insertSegment('seg-2', 1);

        await service.getLineup('lineup-1');

        expect(segments.findByIds).toHaveBeenCalledOnce();
    });
});

// Every edit to the ORDER of a lineup has to reach the reactor, which is holding its own copy of
// it. None of these did before, so an operator could reorder what was on air and hear no
// difference until something else happened to make the reactor re-read the plan.
describe('DirectorConsoleService telling the reactor about an edit', () => {
    const READY = { id: 'seg-1', kind: 'ident', state: 'ready' as const, label: 'Ident', source: 'library' };
    const onAir = { onAir: { lineupId: 'lineup-1' } };

    it('announces a segment added to the lineup that is on air', async () => {
        const { service, director, seed } = build({ segments: [READY], ...onAir });
        await seed();

        await service.addSegment('lineup-1', { segmentId: 'seg-1' });

        expect(director.invalidate).toHaveBeenCalled();
    });

    it('announces a shuffle', async () => {
        const { service, director, seed, settle } = build({
            ...onAir,
            existing: [
                { pluginId: 'p', externalId: 'a', title: 'A', artists: ['X'] },
                { pluginId: 'p', externalId: 'b', title: 'B', artists: ['Y'] },
            ],
        });
        await seed();

        await service.shuffleLineup('lineup-1', {});
        await settle();

        expect(director.invalidate).toHaveBeenCalled();
        // `planChanged`, not `putOnAir`: an edit to the part nobody has heard yet is not a reason
        // to retract the part they are about to.
        expect(director.post).toHaveBeenCalledWith({ kind: 'planChanged' });
    });

    it('announces a line being dropped', async () => {
        const { service, director, lineup, seed } = build({ ...onAir, existing: [{ pluginId: 'p', externalId: 'a', title: 'A', artists: ['X'] }] });
        await seed();

        await service.removeItem('lineup-1', lineup.all()[0]!.id, {});

        expect(director.invalidate).toHaveBeenCalled();
    });

    // An operator tidying a lineup that is not on air changes nothing the station is doing, and
    // making the reactor re-read the plan for that is work with no listener behind it.
    it('says nothing about a lineup that is not on air', async () => {
        const { service, director, seed } = build({ segments: [READY], onAir: { lineupId: 'a-different-lineup' } });
        await seed();

        await service.addSegment('lineup-1', { segmentId: 'seg-1' });

        expect(director.invalidate).not.toHaveBeenCalled();
    });
});
