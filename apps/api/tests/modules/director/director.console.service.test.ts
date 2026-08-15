// The operator's side. Two things matter here: putting a playlist on air must carry through
// everything the catalog knows about a track without ever failing the broadcast over it, and every
// refusal an edit can produce has to arrive as the status code that says the same thing, because a
// console has to tell somebody standing at the desk why nothing happened.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';
import type { JobBroker } from '@maroonedsoftware/jobbroker';

import { DirectorConsoleService } from '../../../src/modules/director/director.console.service.js';
import type { DirectorService } from '../../../src/modules/director/director.service.js';
import { StationLineup } from '../../../src/modules/director/station.lineup.js';
import type { DirectorCommand, OrderEdit } from '../../../src/modules/director/director.mailbox.js';
import type { StationAirRepository } from '../../../src/modules/director/station.air.repository.js';
import type { TracksRepository } from '../../../src/modules/catalog/tracks.repository.js';
import type { PlaylistsService } from '../../../src/modules/playlists/playlists.service.js';
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
    onAir?: { active?: boolean; name?: string; source?: string; remaining?: number };
    /** What the running order holds, for the edit cases. */
    order?: StationLineup;
    /** What the segment library holds, for the lines a lineup names by id. */
    segments?: Partial<Segment>[];
    /** What the station thinks of the records in the order, keyed by canonical track id. */
    ratings?: Record<string, 'liked' | 'neutral' | 'disliked'>;
    /** The persona a host id resolves to, for the order that names one. */
    persona?: (id: string) => { id: string; label: string } | undefined;
}

function build(options: Options = {}) {
    const air = { goOnAir: vi.fn(async () => {}) } as unknown as StationAirRepository;

    // The one owner of the running order. The fake APPLIES an edit rather than recording that it
    // was asked for, so the assertions below are about what the order became.
    const order = options.order;
    const posted: DirectorCommand[] = [];
    const director = {
        status: vi.fn(() => ({ active: true, airMode: 'audience', remaining: order?.remaining() ?? 0, ...options.onAir })),
        invalidate: vi.fn(),
        post: vi.fn(async (command: DirectorCommand) => {
            posted.push(command);
            return undefined;
        }),
        order: vi.fn(() => order?.toSnapshot()),
        applyEdit: vi.fn(async (edit: OrderEdit) => {
            if (!order) return { ok: false, reason: 'not-found', message: 'nothing on air' } as const;
            if (edit.kind === 'shuffle') return order.shuffleRemaining();
            if (edit.kind === 'move') return order.move(edit.itemId, edit.toIndex);
            if (edit.kind === 'remove') return order.remove(edit.itemId);
            return order.insertSegment(edit.segmentId, edit.atIndex ?? order.size());
        }),
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
        ratingsByTrackId: vi.fn(
            async (ids: readonly string[]) => new Map(ids.flatMap(id => (options.ratings?.[id] ? [[id, options.ratings[id]]] : []))),
        ),
    } as unknown as TracksRepository;

    // Read-only from the console's side: a lineup names a segment and the library owns it.
    const library = new Map<string, Segment>((options.segments ?? []).map(segment => [segment.id!, segment as Segment]));
    const segments = {
        findById: vi.fn(async (id: string) => library.get(id)),
        findByIds: vi.fn(async (ids: readonly string[]) => new Map([...library].filter(([id]) => ids.includes(id)))),
    } as unknown as SegmentRepository;

    const settings = { set: vi.fn(async () => {}) } as unknown as SettingsService;
    const jobs = { send: vi.fn(async () => 'job-1') } as unknown as JobBroker;

    // A signed-in operator by default, because every route on this service is behind
    // `platform.manage` and the actor stamp is most of what its events are for.
    const context = { actor: { kind: 'user', sessionToken: '', actorId: 'actor-1' } } as never;
    const activity = { record: vi.fn(async (_event: Record<string, unknown>) => undefined) };
    // Read-only here: the console names a host and the personas page owns it. `find` answers for
    // the one test that draws a host's name onto the running order.
    const personas = { find: vi.fn(async (id: string) => options.persona?.(id)) } as never;

    return {
        service: new DirectorConsoleService(air, director, playlists, tracks, segments, personas, settings, jobs, context, activity as never, logger),
        activity,
        segments,
        settings,
        air,
        director,
        playlists,
        order,
        posted: () => posted,
        jobs,
        tracks,
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

// What the console carries through from the provider and the catalog. It used to be tested through
// an import step; there is no import any more, so it is tested where it now happens: on the way to
// air.
describe('DirectorConsoleService building a running order from a playlist', () => {
    const tracksOf = (posted: DirectorCommand[]) => (posted[0]?.kind === 'putOnAir' ? posted[0].tracks : []);

    it('keeps what the provider says about the copy it will actually serve', async () => {
        // The provider describes the thing that will play. The catalog describes the work, and
        // must not overwrite the album printed on the copy being aired.
        const { service, posted } = build({
            tracks: [{ id: 'trk_9', title: 'B Side', artists: ['Someone'], album: 'The Single' }],
            catalogRows: [{ externalId: 'trk_9', trackId: 'cat-1', year: 1979, albumName: 'The Album', albumImageUrl: null }],
        });

        await service.putOnAir({ pluginId: 'deadair.spotify', playlistId: 'pl_1' });

        expect(tracksOf(posted())[0]).toMatchObject({ album: 'The Single', year: 1979, trackId: 'cat-1' });
    });

    it('takes the catalog cover over the provider one, because it may already be cached locally', async () => {
        const { service, posted } = build({
            tracks: [{ id: 'trk_9', title: 'B Side', artists: ['Someone'], artworkUrl: 'https://provider.test/cover.jpg' }],
            catalogRows: [{ externalId: 'trk_9', trackId: 'cat-1', year: null, albumName: null, albumImageUrl: 'art/asset-1' }],
        });

        await service.putOnAir({ pluginId: 'deadair.spotify', playlistId: 'pl_1' });

        expect(tracksOf(posted())[0]).toMatchObject({ artworkUrl: 'art/asset-1' });
    });

    it('falls back to the provider cover for a track the catalog has never seen', async () => {
        const { service, posted } = build({
            tracks: [{ id: 'trk_9', title: 'B Side', artists: ['Someone'], artworkUrl: 'https://provider.test/cover.jpg' }],
            catalogRows: [],
        });

        await service.putOnAir({ pluginId: 'deadair.spotify', playlistId: 'pl_1' });

        expect(tracksOf(posted())[0]).toEqual({
            pluginId: 'deadair.spotify',
            externalId: 'trk_9',
            title: 'B Side',
            artists: ['Someone'],
            artworkUrl: 'https://provider.test/cover.jpg',
        });
    });

    it('binds the operator’s brief to the broadcast, trimmed', async () => {
        const { service, posted } = build();

        await service.putOnAir({ brief: '  heavy metal hits  ' });

        expect(posted()[0]).toMatchObject({ kind: 'putOnAir', binding: { brief: 'heavy metal hits' } });
    });

    it('binds a host to the broadcast, so the presenter cannot drift back mid-show', async () => {
        const { service, posted } = build();

        await service.putOnAir({ pluginId: 'deadair.spotify', playlistId: 'pl_1', personaId: ' p-1 ' });

        expect(posted()[0]).toMatchObject({ kind: 'putOnAir', binding: { personaId: 'p-1' } });
    });

    it('goes on air with a host id that names nothing rather than refusing', async () => {
        // The resolver behind it already falls back to the station's own host, which is the same
        // answer a persona deleted mid-broadcast gets. Refusing would be the station declining to
        // broadcast over a question about its DJ.
        const { service, posted } = build({ persona: () => undefined });

        await service.putOnAir({ pluginId: 'deadair.spotify', playlistId: 'pl_1', personaId: 'p-gone' });

        expect(posted()[0]).toMatchObject({ kind: 'putOnAir', binding: { personaId: 'p-gone' } });
    });

    it('treats a blank brief as no brief at all', async () => {
        // Otherwise a console sending an empty box would put an empty instruction in the prompt.
        const { service, posted } = build();

        await service.putOnAir({ brief: '   ' });

        expect(posted()[0]?.kind === 'putOnAir' ? posted()[0] : undefined).not.toHaveProperty('binding.brief');
    });

    it('reports the brief on the running order, so a console can show what is still steering it', async () => {
        const briefed = new StationLineup({ name: 'Tonight', brief: 'heavy metal hits', mode: 'rotation', onEnd: 'extend', source: 'director' });
        const { service } = build({ order: briefed });

        expect(await service.getOrder()).toMatchObject({ brief: 'heavy metal hits' });
    });

    it('goes on air anyway when the catalog read fails', async () => {
        // Metadata is decoration; airing is the job.
        const { service, posted } = build({ catalogError: new Error('the pool is gone') });

        await service.putOnAir({ pluginId: 'deadair.spotify', playlistId: 'pl_1' });

        expect(tracksOf(posted())).toHaveLength(1);
    });

    it('asks the catalog once for the whole playlist', async () => {
        const { service, tracks } = build({
            tracks: [
                { id: 'trk_1', title: 'One', artists: ['A'] },
                { id: 'trk_2', title: 'Two', artists: ['B'] },
            ],
        });

        await service.putOnAir({ pluginId: 'deadair.spotify', playlistId: 'pl_1' });

        expect(tracks.findByBindings).toHaveBeenCalledOnce();
        expect(tracks.findByBindings).toHaveBeenCalledWith('deadair.spotify', ['trk_1', 'trk_2']);
    });
});

describe('DirectorConsoleService.setAirMode', () => {
    it('stores the mode, and tells nothing, because nothing has to be told', async () => {
        const { service, settings, director } = build();

        const air = await service.setAirMode({ airMode: 'always' });

        expect(settings.set).toHaveBeenCalledWith(AIR_MODE_KEY, 'always');
        // The mode is a setting, the settings table is a layer of the app's config, and the
        // transport asks the audience gate for it on every reconcile. There is nothing left here
        // to push it into, and nothing to cancel: the running order has not changed.
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
    it('reads the playlist and hands the records to the director', async () => {
        // The whole of stage 2 in one assertion. Nothing is stored between the playlist and the
        // air: the source is READ at this moment, so it cannot go stale by having been imported
        // and the station's own idents are never written back into somebody's playlist.
        const { service, director, posted } = build();

        await service.putOnAir({ pluginId: 'deadair.spotify', playlistId: 'pl_1', name: 'Discover Weekly' });

        const [command] = posted();
        expect(command).toMatchObject({
            kind: 'putOnAir',
            binding: { name: 'Discover Weekly', source: 'import', sourcePluginId: 'deadair.spotify', sourcePlaylistId: 'pl_1' },
        });
        expect(command?.kind === 'putOnAir' && command.tracks).toHaveLength(1);
    });

    it('cancels the reactor before it posts, not after', async () => {
        // A pass may already be gathering against the programme coming off, and only the epoch
        // reaches it: a command runs AFTER that pass, by which time the stale decision has been
        // applied and three records of the old show are in the new one. That was bug 1.
        const { service, director } = build();
        const order: string[] = [];
        (director.invalidate as unknown as { mockImplementation: (fn: () => void) => void }).mockImplementation(() => order.push('invalidate'));
        (director.post as unknown as { mockImplementation: (fn: () => Promise<undefined>) => void }).mockImplementation(async () => {
            order.push('post');
            return undefined;
        });

        await service.putOnAir({ pluginId: 'deadair.spotify', playlistId: 'pl_1' });

        expect(order).toEqual(['invalidate', 'post']);
    });

    it('starts empty when no playlist is named, rather than refusing', async () => {
        // A rotation with nothing behind it is an ordinary way to start a station: the generator
        // fills it.
        const { service, posted, playlists } = build();

        await service.putOnAir({});

        expect(playlists.getPlaylistTracks).not.toHaveBeenCalled();
        expect(posted()[0]).toMatchObject({ kind: 'putOnAir', tracks: [], binding: { source: 'director' } });
    });

    it('refuses an empty playlist rather than airing silence', async () => {
        const { service, director } = build({ tracks: [] });

        expect(await statusOf(service.putOnAir({ pluginId: 'deadair.spotify', playlistId: 'pl_1' }))).toBe(422);
        expect(director.post).not.toHaveBeenCalled();
    });

    it('lets the playlists read own the plugin narrowing', async () => {
        const forbidden = Object.assign(new Error('Forbidden'), { status: 403 });
        const { service } = build({ playlistError: forbidden });

        expect(await statusOf(service.putOnAir({ pluginId: 'deadair.spotify', playlistId: 'pl_1' }))).toBe(403);
    });
});

// The live running order. Every one of these posts a command and none of them writes anything,
// which is the property the whole decision rests on: there is one copy of what is on air and one
// thing allowed to change it.
describe('DirectorConsoleService editing the running order', () => {
    const READY = { id: 'seg-1', kind: 'ident', state: 'ready' as const, label: 'Ident', source: 'library' };

    const onAirWith = (count: number): StationLineup => {
        const order = new StationLineup({ name: 'Afternoons', mode: 'rotation', onEnd: 'extend', source: 'import' });
        order.append(Array.from({ length: count }, (_, index) => ({ pluginId: 'p', externalId: `t${index}`, title: `T${index}`, artists: ['X'] })));
        return order;
    };

    it('cancels the reactor and applies the edit through it', async () => {
        const order = onAirWith(3);
        const { service, director } = build({ order });

        const result = await service.shuffleOrder();

        expect(director.invalidate).toHaveBeenCalled();
        expect(director.applyEdit).toHaveBeenCalledWith({ kind: 'shuffle' });
        expect(result.items).toHaveLength(3);
    });

    it('records the edit against the operator who made it', async () => {
        // The one surface where a person's decision and the station's own are told apart, which is
        // what `station_events.actor_id` exists for.
        const order = onAirWith(3);
        const { service, activity } = build({ order });

        await service.shuffleOrder();

        expect(activity.record).toHaveBeenCalledOnce();
        expect(activity.record.mock.calls[0]![0]).toMatchObject({
            module: 'director',
            kind: 'order.shuffle',
            actorId: 'actor-1',
        });
    });

    it('records nothing for an edit the director refused', async () => {
        // A 422 did not happen to the station, so it does not belong in a feed that says what did.
        const { service, activity } = build({ order: onAirWith(2) });

        await expect(service.removeOrderItem('nope')).rejects.toThrow();

        expect(activity.record).not.toHaveBeenCalled();
    });

    it('answers with the running order the edit produced', async () => {
        const order = onAirWith(2);
        const { service } = build({ order });

        const after = await service.removeOrderItem(order.all()[1]!.id);

        expect(after.items.map(item => item.externalId)).toEqual(['t0']);
    });

    it('maps an unknown item onto a not-found', async () => {
        const { service } = build({ order: onAirWith(2) });

        expect(await statusOf(service.removeOrderItem('nope'))).toBe(404);
    });

    it('maps an item already with the player onto an unprocessable request', async () => {
        // The operator is asking to reorder something a listener is about to hear. Quietly doing
        // something else instead is worse than saying no.
        const order = onAirWith(3);
        for (const item of order.nextPlanned(2)) order.markHanded(item.id);
        const { service } = build({ order });

        expect(await statusOf(service.removeOrderItem(order.all()[0]!.id))).toBe(422);
    });

    it('maps a shuffle with nothing left onto an unprocessable request', async () => {
        const { service } = build({ order: onAirWith(1) });

        expect(await statusOf(service.shuffleOrder())).toBe(422);
    });

    it('refuses a segment with no audio at the door rather than planting one the station will skip', async () => {
        // An operator who asks for a specific ident should be told it cannot play, not watch the
        // order accept it and the station quietly pass over it.
        const { service, director } = build({ order: onAirWith(2), segments: [{ ...READY, state: 'planned' }] });

        expect(await statusOf(service.addSegmentToOrder({ segmentId: 'seg-1' }))).toBe(422);
        expect(director.applyEdit).not.toHaveBeenCalled();
    });

    it('refuses a segment the library does not hold', async () => {
        const { service } = build({ order: onAirWith(2) });

        expect(await statusOf(service.addSegmentToOrder({ segmentId: 'seg-1' }))).toBe(404);
    });

    it('puts a ready segment into the order', async () => {
        const { service } = build({ order: onAirWith(2), segments: [READY] });

        const after = await service.addSegmentToOrder({ segmentId: 'seg-1', atIndex: 1 });

        expect(after.items.map(item => item.kind)).toEqual(['track', 'segment', 'track']);
    });

    it('queues an extend rather than making the operator wait for it', async () => {
        // Generating walks the catalog and, later, rate-limited providers.
        const { service, jobs } = build({ order: onAirWith(2) });

        await service.extendOrder({ count: 5 });

        expect(jobs.send).toHaveBeenCalledWith('director.extend_lineup', { count: 5 });
    });

    // The rating is read as the order is DRAWN rather than stored on the lineup: the director owns
    // that document, and a copy of an opinion in it would be a second answer going stale the moment
    // the operator changed their mind.
    it('carries what the station thinks of each record, and says nothing about one the catalog has never seen', async () => {
        const order = new StationLineup({ name: 'Afternoons', mode: 'rotation', onEnd: 'extend', source: 'import' });
        order.append([
            { pluginId: 'p', externalId: 't0', title: 'Known', artists: ['X'], trackId: 'trk_known' },
            { pluginId: 'p', externalId: 't1', title: 'Uningested', artists: ['Y'] },
        ]);
        const { service, tracks } = build({ order, ratings: { trk_known: 'disliked' } });

        const drawn = await service.getOrder();

        expect(tracks.ratingsByTrackId).toHaveBeenCalledWith(['trk_known']);
        expect(drawn.items.map(item => item.rating)).toEqual(['disliked', undefined]);
    });

    it('draws an empty running order rather than a 404 when nothing is on', async () => {
        // Nothing on air is an ordinary state. The console shows an empty order and the operator
        // puts something on.
        const { service } = build();

        expect(await service.getOrder()).toMatchObject({ items: [] });
    });
});
