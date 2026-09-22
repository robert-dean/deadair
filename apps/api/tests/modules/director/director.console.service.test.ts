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
import type { ChartsService } from '../../../src/modules/charts/charts.service.js';
import type { PlaylistsService } from '../../../src/modules/playlists/playlists.service.js';
import type { RundownTrack } from '../../../src/modules/playout/rundown.js';
import type { Segment, SegmentRepository } from '../../../src/modules/render/segment.repository.js';
import type { ArtAsset, ArtRepository } from '../../../src/modules/art/art.repository.js';
import { breakArtKey } from '../../../src/modules/art/break.art.js';
import type { SettingsService } from '../../../src/modules/settings/settings.service.js';
import type { PickResolver } from '../../../src/modules/director/pick.resolver.js';
import type { CandidatesRepository } from '../../../src/modules/director/candidates.repository.js';
import type { TrackAudioService } from '../../../src/modules/playout/audio/track.audio.service.js';
import { AIR_MODE_KEY } from '../../../src/modules/playout/air.mode.js';
import { ROTATION_KEYS } from '../../../src/modules/director/rotation.rules.js';
import type { PlayHistoryRepository } from '../../../src/modules/director/play.history.repository.js';
import { songKey } from '../../../src/modules/director/rotation.keys.js';
import { SMART_SHUFFLE_KEYS } from '../../../src/modules/director/smart.shuffle.js';
import { StationIdentity } from '../../../src/modules/shared/station.identity.js';
import type { PersonaKind } from '../../../src/modules/personas/persona.js';
import { settingsConfig } from '../../utils/settings.config.js';

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
    /** What the director answers a request for a changeover with, or throws. Accepted by default. */
    changeoverAnswer?: { accepted: boolean; reason?: string };
    /** What the segment library holds, for the lines a lineup names by id. */
    segments?: Partial<Segment>[];
    /**
     * The pictures the station holds for a kind of break, keyed by kind rather than by the
     * `deadair:break-art/<kind>` row key, so a case reads as "a weather forecast has a picture".
     */
    breakArt?: Record<string, { id: string; ext?: ArtAsset['ext']; checksum?: string }>;
    /** What the art table does when the order is drawn, for the case where it cannot be read. */
    artError?: Error;
    /** What the station thinks of the records in the order, keyed by canonical track id. */
    ratings?: Record<string, 'liked' | 'neutral' | 'disliked'>;
    /**
     * The persona a host id resolves to, for the order that names one.
     *
     * `kind` is required rather than defaulted here, because the repository's row mapper always
     * sets it and a double that quietly filled it in would pass whatever `recast` did with a
     * caller. The column is `not null`; so is this.
     */
    persona?: (id: string) => { id: string; label: string; kind: PersonaKind } | undefined;
    /** The slot of the day in force. Absent is the ordinary state: a station with no schedule. */
    slot?: { id: string };
    /** The veto's own answer, when a case wants it to actually drop something rather than pass everything through. */
    vet?: (tracks: RundownTrack[]) => RundownTrack[];
    /** Stored `deadair.settings` rows, as the TEXT they are stored as. Empty is a station nobody has configured. */
    settings?: Record<string, string>;
    /** A hold already on the running order, as epoch millis. `Infinity` never lapses. */
    holdUntil?: number;
    /** What the chart named by `chartId` answers with. Absent is a chart that could not be read. */
    chart?: { rank: number; title: string; artist: string; year?: number }[];
    /** What the chart MENU offers, for the broadcast that takes its name from it. */
    chartMenu?: { id: string; name: string }[];
    /** What the resolver makes of a chart's picks. Absent turns every pick into a playable record. */
    resolve?: (picks: { title: string; artist: string }[]) => RundownTrack[];
    /** One catalog row, for `addTrackToOrder`'s own lookup by id. Absent is a record the catalog does not hold. */
    catalogTrack?: { id: string; title: string; artists: string; artistName?: string; albumName?: string; albumImageUrl?: string; year?: number };
    /** A playable binding for that same record. Absent is a record no provider currently lists. */
    trackBinding?: { pluginId: string; externalId: string; durationMs?: number };
    /** Whether that binding's audio is on this machine. Defaults to true, so a case that cares turns it off. */
    audioReady?: boolean;
    /** Song keys the history says aired inside the smart shuffle's horizon. */
    recentSongs?: string[];
    /** Whether the transport says something is on air, for the cut behind a skip to a record. */
    airing?: boolean;
    /** Whether the stream takes that cut. Defaults to true. */
    cutTakes?: boolean;
    /** The id of the item the transport says is on air. Defaults to one no running order holds. */
    onAirId?: string;
    /**
     * What `CandidatesRepository.effectiveRating` answers for a canonical track id, for the veto.
     *
     * The EFFECTIVE number rather than a level's own column, because that is what `ratingsFor`
     * returns and the whole point of it is that it has already collapsed track, record, lead artist
     * and every credited artist into one. A case says `-1` and means "the station may not play this",
     * without having to say which of the four said so.
     */
    effectiveRatings?: Record<string, number>;
}

function build(options: Options = {}) {
    const air = { goOnAir: vi.fn(async () => {}) } as unknown as StationAirRepository;

    // The one owner of the running order. The fake APPLIES an edit rather than recording that it
    // was asked for, so the assertions below are about what the order became.
    const order = options.order;
    const posted: DirectorCommand[] = [];
    // Whatever the last hold left behind, so `getAir` reads back what `holdAgainstSchedule` wrote.
    let held: number | undefined = options.holdUntil;
    // The last binding the console posted, so `status()` answers what the director WOULD be holding
    // rather than a fixed object. `getAir` derives `airSource` from `placedBy` and `slotId`, and a
    // status that never changed would report the same driver whatever was put on.
    const onAirBinding = () => {
        const last = [...posted].reverse().find(command => command.kind === 'putOnAir');
        return last?.kind === 'putOnAir' ? last.binding : undefined;
    };

    const director = {
        status: vi.fn(() => ({
            active: true,
            airMode: 'audience',
            remaining: order?.remaining() ?? 0,
            ...(onAirBinding() === undefined
                ? {}
                : { placedBy: onAirBinding()!.placedBy, ...(onAirBinding()!.slotId === undefined ? {} : { slotId: onAirBinding()!.slotId }) }),
            ...options.onAir,
        })),
        invalidate: vi.fn(),
        // The hold rides the running order, so the fake keeps it the way the real one does: set by
        // `holdAgainstSchedule` and read back by `getAir`, rather than a fixed answer that would
        // make every hold assertion below pass whatever the service did.
        holdUntil: vi.fn(() => held),
        holdAgainstSchedule: vi.fn(async (until?: number) => {
            held = until;
        }),
        post: vi.fn(async (command: DirectorCommand) => {
            posted.push(command);
            return undefined;
        }),
        order: vi.fn(() => order?.toSnapshot()),
        requestBreak: vi.fn(async () => options.changeoverAnswer ?? { accepted: true, requestId: 'req-1', segmentId: 'seg-1' }),
        applyEdit: vi.fn(async (edit: OrderEdit) => {
            if (!order) return { ok: false, reason: 'not-found', message: 'nothing on air' } as const;
            if (edit.kind === 'shuffle') return order.shuffleRemaining().result;
            if (edit.kind === 'move') return order.move(edit.itemId, edit.toIndex);
            if (edit.kind === 'remove') return order.remove(edit.itemId);
            if (edit.kind === 'insertTrack') return order.insertTrack(edit.track, edit.atIndex ?? order.size());
            if (edit.kind === 'skipTo') return order.skipTo(edit.itemId).result;
            if (edit.kind === 'vetoDisliked') return order.veto(edit.itemIds).result;
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
        // Every record the service asks about is catalogued unless a case says otherwise, because that
        // is the ordinary state of a playlist the sync has walked, and an order made of nothing but
        // uncatalogued records is now refused. A case about the catalog hands over its own rows.
        findByBindings: vi.fn(async (_pluginId: string, ids: readonly string[]) => {
            if (options.catalogError) throw options.catalogError;
            return options.catalogRows ?? ids.map(id => ({ externalId: id, trackId: `cat-${id}`, year: null, albumName: null, albumImageUrl: null }));
        }),
        findTrack: vi.fn(async (id: string) => (options.catalogTrack?.id === id ? options.catalogTrack : undefined)),
        catalogRowsByTrackId: vi.fn(
            async (ids: readonly string[]) =>
                new Map(
                    ids.flatMap(id =>
                        options.ratings?.[id]
                            ? [
                                  [
                                      id,
                                      {
                                          rating: options.ratings[id],
                                          artistId: `art_${id}`,
                                          ...(id.endsWith('_single') ? {} : { albumId: `alb_${id}` }),
                                      },
                                  ],
                              ]
                            : [],
                    ),
                ),
        ),
    } as unknown as TracksRepository;

    // Read-only from the console's side: a lineup names a segment and the library owns it.
    const library = new Map<string, Segment>((options.segments ?? []).map(segment => [segment.id!, segment as Segment]));
    const segments = {
        findById: vi.fn(async (id: string) => library.get(id)),
        findByIds: vi.fn(async (ids: readonly string[]) => new Map([...library].filter(([id]) => ids.includes(id)))),
    } as unknown as SegmentRepository;

    // Read-only too, and asked one question: which kinds of break have a picture. Keyed the way the
    // service keys it, through `breakArtKey`, so a test that spelled the row key by hand could not
    // pass against a service that spelled it differently.
    const art = {
        findBySourceUrls: vi.fn(async (sourceUrls: readonly string[]) => {
            if (options.artError !== undefined) throw options.artError;
            const held = Object.entries(options.breakArt ?? {}).map(([kind, asset]): [string, ArtAsset] => [
                breakArtKey(kind),
                { sourceUrl: breakArtKey(kind), checksum: 'sum', ext: 'png', ...asset },
            ]);
            return new Map(held.filter(([sourceUrl]) => sourceUrls.includes(sourceUrl)));
        }),
    } as unknown as ArtRepository;

    const settings = { set: vi.fn(async () => {}) } as unknown as SettingsService;
    const jobs = { send: vi.fn(async () => 'job-1') } as unknown as JobBroker;

    // A real `AppConfig` over stored STRINGS rather than a double answering booleans, because a
    // double that coerces on the way out is worse than none: `rotation.autoExtend` is read through
    // `settingIsOn`, and a test handing over `false` would pass whether or not that reader existed.
    // Empty is the ordinary station, where nobody has touched the setting.
    const { config } = settingsConfig(options.settings ?? {});

    // A signed-in operator by default, because every route on this service is behind
    // `platform.manage` and the actor stamp is most of what its events are for.
    const context = { actor: { kind: 'user', sessionToken: '', actorId: 'actor-1' } } as never;
    const activity = { record: vi.fn(async (_event: Record<string, unknown>) => undefined) };
    // Read-only here: the console names a host and the personas page owns it. `find` answers for
    // the one test that draws a host's name onto the running order.
    const personas = { find: vi.fn(async (id: string) => options.persona?.(id)) };
    // Read-only here too, and the default is the ordinary state: a station with no schedule, so a
    // broadcast an operator starts by hand is stamped with no slot. The one test that cares hands
    // over its own.
    const schedule = { inForce: vi.fn(async () => options.slot) } as never;

    // The put-on-air veto. A pass-through by default, so every case above this one behaves exactly
    // as it did before the veto existed; a case that cares hands over its own answer.
    const resolver = {
        vet: vi.fn(async (playlistTracks: RundownTrack[]) => (options.vet ? options.vet(playlistTracks) : playlistTracks)),
        // A chart names records rather than copies, so its path goes through `resolve` instead. The
        // default turns every pick into something playable, IN ORDER, because the order is what the
        // chart cases are about — a double that reordered would make a countdown untestable here.
        resolve: vi.fn(async (picks: { title: string; artist: string }[]) =>
            options.resolve
                ? options.resolve(picks)
                : picks.map((pick, at) => ({
                      pluginId: 'deadair.lastfm',
                      externalId: `ext_${at}`,
                      title: pick.title,
                      artists: [pick.artist],
                      artist: pick.artist,
                  })),
        ),
    } as unknown as PickResolver;

    // Read-only, like the playlists beside it. `fetchChart` answers nothing by default, which is the
    // state `ChartsService` flattens every upstream failure to and the one the console has to refuse.
    const charts = {
        fetchChart: vi.fn(async () => options.chart ?? []),
        listCharts: vi.fn(async () => options.chartMenu ?? []),
    } as unknown as ChartsService;

    // The two halves `addTrackToOrder` resolves before it will hand a record to the order: which
    // provider will serve it, and whether that provider's audio is already on this machine. Both
    // default to "yes, and here it is", so cases about the rest of the service are not also cases
    // about these — a case that wants the 404 or the 422 hands over its own `trackBinding`/`audioReady`.
    const candidates = {
        bindingsFor: vi.fn(async (ids: readonly string[]) => {
            const binding = options.trackBinding;
            return new Map(binding && ids.includes(options.catalogTrack?.id ?? '') ? [[ids[0]!, binding]] : []);
        }),
        // Answers for the ids it is ASKED about and no others, the way the real one does: a track
        // the catalog has never heard of is absent rather than `0`, which is the fork the veto has
        // to get right — "no opinion" and "never seen" are different facts and only one is a reason
        // to keep a record.
        ratingsFor: vi.fn(
            async (ids: readonly string[]) =>
                new Map(ids.flatMap(id => (options.effectiveRatings?.[id] === undefined ? [] : [[id, options.effectiveRatings[id]!]]))),
        ),
    } as unknown as CandidatesRepository;
    const trackAudio = {
        has: vi.fn(async () => options.audioReady ?? true),
    } as unknown as TrackAudioService;
    // Read by the smart shuffle alone. Nothing aired lately unless a case says otherwise.
    const history = {
        songKeysSince: vi.fn(async () => new Set(options.recentSongs ?? [])),
    } as unknown as PlayHistoryRepository;
    // The transport's half of a skip to a record. The cut remembers what the order said when it
    // landed, which is how a case can tell the edit happened first.
    const rundown = {
        nowPlaying: vi.fn(() => (options.airing ? { item: { id: options.onAirId ?? 'on-air', title: 'Echoes' }, startedAt: 0 } : undefined)),
    };
    const cutAgainst: string[][] = [];
    const pusher = {
        skipCurrent: vi.fn(async () => {
            cutAgainst.push(order?.all().map(item => item.state) ?? []);
            return options.cutTakes ?? true;
        }),
    };

    return {
        service: new DirectorConsoleService(
            air,
            director,
            playlists,
            charts,
            tracks,
            segments,
            personas as never,
            schedule,
            settings,
            config,
            jobs,
            context,
            activity as never,
            logger,
            resolver,
            candidates,
            trackAudio,
            history,
            new StationIdentity(),
            rundown as never,
            pusher as never,
            art,
        ),
        pusher,
        art,
        cutAgainst,
        history,
        activity,
        personas,
        charts,
        resolver,
        segments,
        settings,
        air,
        director,
        playlists,
        order,
        posted: () => posted,
        jobs,
        tracks,
        schedule,
        candidates,
        trackAudio,
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

/** What a refusal actually SAID, for the cases where the wording is the behaviour under test. */
const refusalOf = async (call: Promise<unknown>): Promise<string> => {
    try {
        await call;
        return '';
    } catch (error) {
        return (error as { details?: { message?: string } }).details?.message ?? '';
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
        // A neighbour the catalog DOES know, because an order made of nothing but uncatalogued records
        // is refused outright; the fallback is for the uncatalogued record inside an airable order.
        const { service, posted } = build({
            tracks: [
                { id: 'trk_9', title: 'B Side', artists: ['Someone'], artworkUrl: 'https://provider.test/cover.jpg' },
                { id: 'trk_known', title: 'Known', artists: ['Else'] },
            ],
            catalogRows: [{ externalId: 'trk_known', trackId: 'cat-known', year: null, albumName: null, albumImageUrl: null }],
        });

        await service.putOnAir({ pluginId: 'deadair.spotify', playlistId: 'pl_1' });

        expect(tracksOf(posted())[0]).toEqual({
            pluginId: 'deadair.spotify',
            externalId: 'trk_9',
            title: 'B Side',
            artists: ['Someone'],
            artist: 'Someone',
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

    it('stamps the slot of the day an operator started the broadcast in', async () => {
        // The whole of the manual-takeover rule. The tick compares this against the slot it
        // resolves, so stamping it here is what makes an operator's own choice hold until the NEXT
        // slot begins rather than being changed over a minute later by a schedule that sees a
        // mismatch. Nothing about the source, the host or the brief comes from the slot: the
        // operator chose those.
        const { service, posted } = build({ slot: { id: 'slot-morning' } });

        await service.putOnAir({ pluginId: 'deadair.spotify', playlistId: 'pl_1' });

        expect(posted()[0]).toMatchObject({ kind: 'putOnAir', binding: { slotId: 'slot-morning' } });
    });

    it('goes on air with no slot when the station has no schedule', async () => {
        const { service, posted } = build();

        await service.putOnAir({ pluginId: 'deadair.spotify', playlistId: 'pl_1' });

        expect(posted()[0]?.kind === 'putOnAir' ? posted()[0] : undefined).not.toHaveProperty('binding.slotId');
    });

    it('still goes on air when the schedule cannot be read', async () => {
        // Same call as the dangling host above: a page nobody opened failing to load must not be
        // the reason the station will not broadcast.
        const { service, posted, schedule } = build();
        (schedule as { inForce: ReturnType<typeof vi.fn> }).inForce.mockRejectedValueOnce(new Error('no'));

        await service.putOnAir({ pluginId: 'deadair.spotify', playlistId: 'pl_1' });

        expect(posted()[0]).toMatchObject({ kind: 'putOnAir' });
    });

    it('binds a request to mix similar records in as a rule of the broadcast, beside calls', async () => {
        const { service, posted } = build();

        await service.putOnAir({ pluginId: 'deadair.spotify', playlistId: 'pl_1', mixInSimilar: true, callins: false });

        expect(posted()[0]).toMatchObject({ kind: 'putOnAir', binding: { rules: { mixInSimilar: true, callins: false } } });
    });

    it('leaves the rules off the binding when the operator asked for none, so the station settings stand', async () => {
        const { service, posted } = build();

        await service.putOnAir({ pluginId: 'deadair.spotify', playlistId: 'pl_1' });

        expect(posted()[0]?.kind === 'putOnAir' ? posted()[0] : undefined).not.toHaveProperty('binding.rules');
    });

    it('treats a blank brief as no brief at all', async () => {
        // Otherwise a console sending an empty box would put an empty instruction in the prompt.
        const { service, posted } = build();

        await service.putOnAir({ brief: '   ' });

        expect(posted()[0]?.kind === 'putOnAir' ? posted()[0] : undefined).not.toHaveProperty('binding.brief');
    });

    it('takes what a rotation does when it runs out from the station setting, when nobody said', async () => {
        const { service, posted } = build();

        await service.putOnAir({ brief: 'heavy metal hits' });

        expect(posted()[0]).toMatchObject({ kind: 'putOnAir', binding: { onEnd: 'extend' } });
    });

    it('starts a rotation that stops when the station is set not to top itself up', async () => {
        // The string rather than a boolean, because that is what the settings table holds and
        // `config.get(key, false)` answers `'false'`, which is truthy.
        const { service, posted } = build({ settings: { [ROTATION_KEYS.autoExtend]: 'off' } });

        await service.putOnAir({ brief: 'heavy metal hits' });

        expect(posted()[0]).toMatchObject({ kind: 'putOnAir', binding: { onEnd: 'stop' } });
    });

    it('lets the operator overrule that setting for one broadcast, because it is a default', async () => {
        // The whole point of the split. The setting decides where a new broadcast STARTS, and it
        // must never be able to reach a broadcast somebody has already described.
        const { service, posted } = build({ settings: { [ROTATION_KEYS.autoExtend]: 'off' } });

        await service.putOnAir({ brief: 'heavy metal hits', onEnd: 'extend' });

        expect(posted()[0]).toMatchObject({ kind: 'putOnAir', binding: { onEnd: 'extend' } });
    });

    it('stores a setlist as stopping, because nothing may generate into one', async () => {
        // `extend` on a setlist is not a preference the station declines to honour, it is a state
        // with no behaviour: `mayGenerate` is false, so the order would end and sit exhausted,
        // which is what `stop` says. Storing the word that matches is what keeps the console's
        // "it tops itself up before then" true of every row that can hold it.
        const { service, posted } = build();

        await service.putOnAir({ brief: 'the whole album', mode: 'setlist', onEnd: 'extend' });

        expect(posted()[0]).toMatchObject({ kind: 'putOnAir', binding: { mode: 'setlist', onEnd: 'stop' } });
    });

    it('leaves a setlist that was asked to start again alone', async () => {
        // Only `extend` is the impossible one. Repeating needs nothing generated.
        const { service, posted } = build();

        await service.putOnAir({ brief: 'the whole album', mode: 'setlist', onEnd: 'repeat' });

        expect(posted()[0]).toMatchObject({ kind: 'putOnAir', binding: { onEnd: 'repeat' } });
    });

    it('names the operator as the driver when a person put the station on, even inside a slot', async () => {
        // The point of storing this rather than comparing ids. A takeover is stamped with whatever
        // slot is in force so it HOLDS until the next boundary, which means the stamp cannot also
        // say who chose it — and telling an operator the schedule is driving while they are is the
        // one thing the desk has to get right.
        const { service } = build({ slot: { id: 'slot-morning' } });

        await service.putOnAir({ brief: 'heavy metal hits' });

        expect((await service.getAir()).airSource).toBe('operator');
    });

    it('names the schedule when the clock handed it a slot', async () => {
        const { service } = build();

        await service.putOnAir({ brief: 'the usual' }, { id: 'slot-morning' } as never);

        expect((await service.getAir()).airSource).toBe('schedule');
    });

    it('tells a gap apart from a block, because they are different answers to "why is this on"', async () => {
        // A sustaining broadcast carries no slot, which is exactly the shape a hand-driven broadcast
        // started during the same gap has. The third argument is what separates them.
        const { service } = build();

        await service.putOnAir({ name: 'Sustaining', brief: 'warm and unhurried' }, undefined, true);

        expect((await service.getAir()).airSource).toBe('sustaining');
    });

    it('says off for a station that is stood down, whoever put it on', async () => {
        const { service } = build({ onAir: { active: false } });

        expect((await service.getAir()).airSource).toBe('off');
    });

    it('holds until released when no duration was named, because Infinity is not JSON', async () => {
        // The wire carries two fields rather than one for exactly this: `held` is the fact a console
        // acts on and `holdUntil` is when it lapses, so the hold that never lapses is `held` with no
        // instant beside it rather than a number JSON cannot express.
        const { service } = build();

        const air = await service.holdAgainstSchedule({});

        expect(air.held).toBe(true);
        expect(air).not.toHaveProperty('holdUntil');
    });

    it('names the instant a timed hold lapses', async () => {
        const { service } = build();

        const air = await service.holdAgainstSchedule({ minutes: 120 });

        expect(air.held).toBe(true);
        expect(Date.parse(air.holdUntil!)).toBeGreaterThan(Date.now());
    });

    it('reports a lapsed hold as no hold, so the badge clears itself', async () => {
        const { service } = build({ holdUntil: Date.now() - 1 });

        expect((await service.getAir()).held).toBe(false);
    });

    it('releases a station that was never held, rather than arguing about it', async () => {
        // A 404 here would be the console refusing an operator the outcome they wanted on the
        // grounds that it had already happened.
        const { service } = build();

        expect((await service.releaseToSchedule()).held).toBe(false);
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

    it('refuses a playlist the veto empties rather than airing silence in its place', async () => {
        // The same refusal an empty playlist gets, and it has to be asked AFTER the veto as well as
        // before it. A playlist whose every record the station may not play is empty for this
        // purpose too, and letting it through reports success and then airs either nothing or the
        // station's own rotation in place of the playlist the operator actually chose — with
        // nothing anywhere saying the choice had been overruled.
        const { service, director } = build({
            tracks: [{ id: 'trk_1', title: 'Disliked', artists: ['One'] }],
            vet: () => [],
        });

        expect(await statusOf(service.putOnAir({ pluginId: 'deadair.spotify', playlistId: 'pl_1' }))).toBe(422);
        expect(director.post).not.toHaveBeenCalled();
    });

    it('refuses a playlist none of whose records the catalog knows, rather than airing the bed', async () => {
        // The third way to report success and play nothing. A record with no catalog binding has no
        // audio path at all, since the resolver, the cache planner and the commit gate all need one. So
        // an order of nothing else is consumed without a byte fetched and the mount falls through to
        // the bed. Hit with a playlist its provider did not list, which the sync therefore never reached.
        const { service, director } = build({
            tracks: [
                { id: 'trk_1', title: 'One', artists: ['A'] },
                { id: 'trk_2', title: 'Two', artists: ['B'] },
            ],
            catalogRows: [],
        });

        expect(await statusOf(service.putOnAir({ pluginId: 'deadair.spotify', playlistId: 'pl_1' }))).toBe(422);
        expect(director.post).not.toHaveBeenCalled();
    });

    it('says the playlist is not in the library yet, and why that happens', async () => {
        // The wording is the behaviour: the operator's next move is a sync or a playlist the provider
        // lists, and "the playlist is empty" or "the station will not play it" would send them looking
        // at the wrong thing entirely.
        const { service } = build({ catalogRows: [] });

        const said = await refusalOf(service.putOnAir({ pluginId: 'deadair.spotify', playlistId: 'pl_1' }));

        expect(said).toContain('in the library yet');
        expect(said).toContain('sync');
    });

    it('airs a playlist only some of whose records are catalogued', async () => {
        // The refusal is for an order that can play NOTHING. One the catalog half knows goes on air as
        // it always did, and its uncatalogued records are the ordinary skip at their slot.
        const { service, posted } = build({
            tracks: [
                { id: 'trk_known', title: 'Known', artists: ['A'] },
                { id: 'trk_new', title: 'New', artists: ['B'] },
            ],
            catalogRows: [{ externalId: 'trk_known', trackId: 'cat-known', year: null, albumName: null, albumImageUrl: null }],
        });

        await service.putOnAir({ pluginId: 'deadair.spotify', playlistId: 'pl_1' });

        const command = posted()[0];
        expect(command).toMatchObject({ kind: 'putOnAir' });
        expect(command?.kind === 'putOnAir' ? command.tracks : []).toHaveLength(2);
    });

    it('refuses when the veto leaves only records the catalog does not know', async () => {
        // Judged on what SURVIVES the veto. If every catalogued record is vetoed away, what is left
        // cannot play either.
        const { service, director } = build({
            tracks: [
                { id: 'trk_known', title: 'Known', artists: ['A'] },
                { id: 'trk_new', title: 'New', artists: ['B'] },
            ],
            catalogRows: [{ externalId: 'trk_known', trackId: 'cat-known', year: null, albumName: null, albumImageUrl: null }],
            vet: records => records.filter(record => record.trackId === undefined),
        });

        expect(await statusOf(service.putOnAir({ pluginId: 'deadair.spotify', playlistId: 'pl_1' }))).toBe(422);
        expect(director.post).not.toHaveBeenCalled();
    });

    it('does not refuse when the catalog could not be READ, only when it answered', async () => {
        // A failed read leaves every record without a trackId for a reason that has nothing to do with
        // the playlist. Refusing on that would take a station's playlists off the air over a transient
        // database fault, which is the failure the commit gate fails open to avoid.
        const { service, posted } = build({ catalogError: new Error('the pool is gone') });

        await service.putOnAir({ pluginId: 'deadair.spotify', playlistId: 'pl_1' });

        expect(posted()[0]).toMatchObject({ kind: 'putOnAir' });
    });

    it('lets the playlists read own the plugin narrowing', async () => {
        const forbidden = Object.assign(new Error('Forbidden'), { status: 403 });
        const { service } = build({ playlistError: forbidden });

        expect(await statusOf(service.putOnAir({ pluginId: 'deadair.spotify', playlistId: 'pl_1' }))).toBe(403);
    });

    it('runs the playlist through the veto', async () => {
        // No lineup may turn off a dislike, and a playlist is a lineup like any other: the veto
        // has to see every track this source names before one reaches the running order.
        const { service, posted, resolver } = build({
            tracks: [
                { id: 'trk_1', title: 'Keep', artists: ['One'] },
                { id: 'trk_2', title: 'Drop', artists: ['Two'] },
            ],
            vet: playlistTracks => playlistTracks.filter(track => track.externalId !== 'trk_2'),
        });

        await service.putOnAir({ pluginId: 'deadair.spotify', playlistId: 'pl_1', eraFrom: 1980, eraTo: 1989 });

        expect(resolver.vet).toHaveBeenCalledWith(
            expect.arrayContaining([expect.objectContaining({ externalId: 'trk_1' }), expect.objectContaining({ externalId: 'trk_2' })]),
            { era: { from: 1980, to: 1989 }, preference: ['deadair.spotify'] },
        );

        const [command] = posted();
        expect(command?.kind === 'putOnAir' && command.tracks.map(track => track.externalId)).toEqual(['trk_1']);
    });

    it('folds two rips of one song', async () => {
        const { service, posted } = build({
            tracks: [
                { id: 'trk_1', title: 'Same Song', artists: ['An Artist'] },
                { id: 'trk_2', title: 'Same Song', artists: ['An Artist'] },
            ],
        });

        await service.putOnAir({ pluginId: 'deadair.spotify', playlistId: 'pl_1' });

        const [command] = posted();
        expect(command?.kind === 'putOnAir' && command.tracks.map(track => track.externalId)).toEqual(['trk_1']);
    });
});

// The live running order. Every one of these posts a command and none of them writes anything,
// which is the property the whole decision rests on: there is one copy of what is on air and one
// thing allowed to change it.
describe('DirectorConsoleService editing the running order', () => {
    const READY = { id: 'seg-1', kind: 'ident', state: 'ready' as const, label: 'Ident', source: 'library' };

    const onAirWith = (count: number): StationLineup => {
        const order = new StationLineup({ name: 'Afternoons', mode: 'rotation', onEnd: 'extend', source: 'import' });
        order.append(
            Array.from({ length: count }, (_, index) => ({
                pluginId: 'p',
                externalId: `t${index}`,
                title: `T${index}`,
                artists: ['X'],
                artist: 'X',
            })),
        );
        return order;
    };

    it('cancels the reactor and applies the edit through it', async () => {
        const order = onAirWith(3);
        const { service, director } = build({ order });

        const result = await service.shuffleOrder();

        expect(director.invalidate).toHaveBeenCalled();
        expect(director.applyEdit).toHaveBeenCalledWith({ kind: 'shuffle', smart: { recentSongKeys: [] } });
        expect(result.items).toHaveLength(3);
    });

    it('carries what aired lately on the command, so the edit pass reads nothing', async () => {
        const recent = songKey('T1', ['X']);
        const { service, director, history } = build({ order: onAirWith(3), recentSongs: [recent] });

        await service.shuffleOrder();

        expect(history.songKeysSince).toHaveBeenCalledWith(14, 'main');
        expect(director.applyEdit).toHaveBeenCalledWith({ kind: 'shuffle', smart: { recentSongKeys: [recent] } });
    });

    it('is the plain shuffle, reading no history, when smart shuffle is off in the row', async () => {
        const { service, director, history } = build({ order: onAirWith(3), settings: { [SMART_SHUFFLE_KEYS.enabled]: 'false' } });

        await service.shuffleOrder();

        expect(history.songKeysSince).not.toHaveBeenCalled();
        expect(director.applyEdit).toHaveBeenCalledWith({ kind: 'shuffle' });
    });

    it('says a smart shuffle was smart on the feed, without copying the history into the row', async () => {
        const { service, activity } = build({ order: onAirWith(3), recentSongs: [songKey('T1', ['X']), songKey('T2', ['X'])] });

        await service.shuffleOrder();

        const event = activity.record.mock.calls[0]![0];
        expect(event).toMatchObject({ kind: 'order.shuffle', data: { kind: 'shuffle', smart: true } });
        expect(JSON.stringify(event)).not.toContain('recentSongKeys');
        expect(event.detail).toContain('aired lately');
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

    describe('skipping to a record', () => {
        it('moves the order first and then cuts what is on air, so the cut lands on the record', async () => {
            const order = onAirWith(4);
            order.markAiring(order.nextPlanned(1)[0]!.id);
            const { service, cutAgainst } = build({ order, airing: true });

            const after = await service.skipToOrderItem(order.all()[3]!.id);

            expect(cutAgainst).toEqual([['airing', 'skipped', 'skipped', 'planned']]);
            expect(after.items.map(item => item.state)).toEqual(['airing', 'skipped', 'skipped', 'planned']);
        });

        it('cuts nothing when nothing is on air, and the record is simply next', async () => {
            // A station stood down, or one whose audience gate is shut: it starts from the record
            // when it next airs, and a skip sent to an idle player could take the queue's head with it.
            const order = onAirWith(3);
            const { service, pusher } = build({ order, airing: false });

            await service.skipToOrderItem(order.all()[2]!.id);

            expect(pusher.skipCurrent).not.toHaveBeenCalled();
            expect(order.all().map(item => item.state)).toEqual(['skipped', 'skipped', 'planned']);
        });

        it('answers with the order when the stream did not take the cut, because the skip in the order stuck', async () => {
            const order = onAirWith(3);
            order.markAiring(order.nextPlanned(1)[0]!.id);
            const { service } = build({ order, airing: true, cutTakes: false });

            const after = await service.skipToOrderItem(order.all()[2]!.id);

            expect(after.items.map(item => item.state)).toEqual(['airing', 'skipped', 'planned']);
            expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('did not take the cut'));
        });

        it('records the skip against the operator who made it', async () => {
            const order = onAirWith(3);
            const { service, activity } = build({ order });

            await service.skipToOrderItem(order.all()[2]!.id);

            expect(activity.record.mock.calls[0]![0]).toMatchObject({ module: 'director', kind: 'order.skipTo', actorId: 'actor-1' });
        });

        it('maps a record that is not still to come onto an unprocessable request, and cuts nothing', async () => {
            const order = onAirWith(2);
            order.markAiring(order.nextPlanned(1)[0]!.id);
            const { service, pusher } = build({ order, airing: true });

            expect(await statusOf(service.skipToOrderItem(order.all()[0]!.id))).toBe(422);
            expect(pusher.skipCurrent).not.toHaveBeenCalled();
        });

        it('maps an unknown item onto a not-found', async () => {
            const { service } = build({ order: onAirWith(2) });

            expect(await statusOf(service.skipToOrderItem('nope'))).toBe(404);
        });
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

    // `addTrackToOrder` is undo's other half — a track drops out of the order entirely rather than
    // being marked, so nothing could put one back until this existed — and it earns the same
    // at-the-door refusals `addSegmentToOrder` does, for the same reason: an operator should be
    // told a record cannot play yet, not watch it accepted and quietly held or skipped later.
    describe('DirectorConsoleService.addTrackToOrder', () => {
        // `artists` is the whole credit line and `artistName` is the LEAD the catalog joined in
        // separately; the two are made to differ here so a test that reads the wrong one is caught.
        const TRACK = { id: 'trk-1', title: 'A Record', artists: 'The Artist, Someone Else', artistName: 'The Artist' };
        const BINDING = { pluginId: 'deadair.spotify', externalId: 'ext-1' };

        it('refuses a record the catalog does not hold', async () => {
            const { service } = build({ order: onAirWith(2) });

            expect(await statusOf(service.addTrackToOrder({ trackId: 'trk-1' }))).toBe(404);
        });

        it('refuses a record no provider currently lists a copy of', async () => {
            const { service } = build({ order: onAirWith(2), catalogTrack: TRACK });

            expect(await statusOf(service.addTrackToOrder({ trackId: 'trk-1' }))).toBe(404);
        });

        it('refuses a record whose audio is not on this machine yet, at the door rather than in the order', async () => {
            const { service, director } = build({
                order: onAirWith(2),
                catalogTrack: TRACK,
                trackBinding: BINDING,
                audioReady: false,
            });

            expect(await statusOf(service.addTrackToOrder({ trackId: 'trk-1' }))).toBe(422);
            expect(director.applyEdit).not.toHaveBeenCalled();
        });

        // The same veto a playlist put on air already runs through: an operator picking one record
        // by hand is not an instruction that gets to route around a dislike, the broadcast's period
        // or the advisory policy.
        it('refuses a disliked record, posting no edit', async () => {
            const { service, director } = build({
                order: onAirWith(2),
                catalogTrack: TRACK,
                trackBinding: BINDING,
                vet: () => [],
            });

            expect(await statusOf(service.addTrackToOrder({ trackId: 'trk-1' }))).toBe(422);
            expect(director.applyEdit).not.toHaveBeenCalled();
        });

        it("runs the record through the veto with the current broadcast's own period, and refuses one outside it", async () => {
            const order = new StationLineup({ name: 'Afternoons', mode: 'rotation', onEnd: 'extend', source: 'import', eraFrom: 1980, eraTo: 1989 });
            order.append([{ pluginId: 'p', externalId: 't0', title: 'T0', artists: ['X'], artist: 'X' }]);
            const { service, director, resolver } = build({
                order,
                catalogTrack: TRACK,
                trackBinding: BINDING,
                vet: () => [],
            });

            expect(await statusOf(service.addTrackToOrder({ trackId: 'trk-1' }))).toBe(422);
            expect(resolver.vet).toHaveBeenCalledWith([expect.objectContaining({ trackId: 'trk-1' })], {
                era: { from: 1980, to: 1989 },
                preference: ['deadair.spotify'],
            });
            expect(director.applyEdit).not.toHaveBeenCalled();
        });

        // On a clean-only station the advisory policy is part of what `vet` reads for itself; this
        // exercises the console's side of that refusal rather than the policy's own logic, which is
        // `PickResolver`'s test file's business.
        it('refuses a record only an explicit copy exists for, on a clean-only station', async () => {
            const { service, director } = build({
                order: onAirWith(2),
                catalogTrack: TRACK,
                trackBinding: BINDING,
                settings: { 'rotation.advisory': 'clean-only' },
                vet: () => [],
            });

            expect(await statusOf(service.addTrackToOrder({ trackId: 'trk-1' }))).toBe(422);
            expect(director.applyEdit).not.toHaveBeenCalled();
        });

        it('puts a ready record into the order at the position asked for', async () => {
            const { service } = build({ order: onAirWith(2), catalogTrack: TRACK, trackBinding: BINDING });

            const after = await service.addTrackToOrder({ trackId: 'trk-1', atIndex: 1 });

            expect(after.items.map(item => item.externalId)).toEqual(['t0', 'ext-1', 't1']);
        });

        it('carries the catalog id through, so the item is still linked to its record', async () => {
            const { service, director } = build({ order: onAirWith(1), catalogTrack: TRACK, trackBinding: BINDING });

            await service.addTrackToOrder({ trackId: 'trk-1' });

            expect(director.applyEdit).toHaveBeenCalledWith(
                expect.objectContaining({ kind: 'insertTrack', track: expect.objectContaining({ trackId: 'trk-1' }) }),
            );
        });

        // Identity is the LEAD, never the whole credit line, so history and the artist cooldown key
        // on the same thing a generator-produced item's does.
        it('inserts an accepted record with the lead artist as identity, not the whole credit line', async () => {
            const { service, director } = build({ order: onAirWith(1), catalogTrack: TRACK, trackBinding: BINDING });

            await service.addTrackToOrder({ trackId: 'trk-1' });

            expect(director.applyEdit).toHaveBeenCalledWith(
                expect.objectContaining({
                    kind: 'insertTrack',
                    track: expect.objectContaining({ artist: 'The Artist', artists: ['The Artist'] }),
                }),
            );
        });
    });

    it('queues an extend rather than making the operator wait for it', async () => {
        // Generating walks the catalog and, later, rate-limited providers.
        const order = onAirWith(2);
        const { service, jobs } = build({ order });

        await service.extendOrder({ count: 5 });

        expect(jobs.send).toHaveBeenCalledWith('director.extend_lineup', { count: 5, broadcastId: order.broadcastId });
    });

    it('queues a replan rather than emptying the order and making the operator wait', async () => {
        // The job generates a whole set BEFORE anything is dropped, which is what keeps the station
        // on air across the swap. Nothing is answered here but the ask.
        const order = onAirWith(3);
        const { service, jobs, director } = build({ order });

        await service.replanOrder({ count: 5 });

        expect(jobs.send).toHaveBeenCalledWith('director.replan_lineup', { count: 5, broadcastId: order.broadcastId });
        expect(director.applyEdit).not.toHaveBeenCalled();
    });

    it('writes a new brief before it asks for the replan, since the job reads it off the row', async () => {
        // The other way round and the fresh hour is programmed against the instruction the operator
        // has just replaced.
        const { service, jobs, director } = build({ order: onAirWith(3) });

        await service.replanOrder({ brief: 'heavy metal hits' });

        expect(director.post).toHaveBeenCalledWith({ kind: 'rebrief', brief: 'heavy metal hits' });
        expect(vi.mocked(director.post)).toHaveBeenCalledBefore(vi.mocked(jobs.send));
    });

    it('says nothing about the brief when the operator did not mention one', async () => {
        // Absent means keep what this broadcast was already asked for. Only an explicit empty
        // string clears it.
        const { service, director } = build({ order: onAirWith(3) });

        await service.replanOrder({ count: 4 });

        expect(director.post).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'rebrief' }));
    });

    it('clears the brief when the operator empties the box, handing programming back to ordinary rotation', async () => {
        const { service, director } = build({ order: onAirWith(3) });

        await service.replanOrder({ brief: '' });

        expect(director.post).toHaveBeenCalledWith({ kind: 'rebrief', brief: '' });
    });

    // The one way a show's host changes without a new broadcast. What it costs — the breaks already
    // written for this show being written again — is the director's half and is tested there.
    it('recasts the broadcast, naming the host the operator picked', async () => {
        const { service, director } = build({ order: onAirWith(3), persona: id => ({ id, label: 'The Pirate', kind: 'host' }) });

        await service.recast({ personaId: 'pirate' });

        expect(director.post).toHaveBeenCalledWith({ kind: 'recast', bind: { personaId: 'pirate' } });
    });

    // The console lists hosts only, and did not until this was written: it offered the whole
    // roster and this path took any persona that existed, so a caller picked from that menu
    // presented the show. Refused with the same sentence `PersonasService.setDefaultHost` uses,
    // because it is the same answer to the same question.
    it('refuses a caller, who phones in to a production and cannot present the station', async () => {
        const { service, director } = build({ order: onAirWith(3), persona: id => ({ id, label: 'Caller who wants proof', kind: 'caller' }) });

        expect(await refusalOf(service.recast({ personaId: 'p-caller' }))).toContain('cannot present the station');
        expect(await statusOf(service.recast({ personaId: 'p-caller' }))).toBe(400);
        expect(director.post).not.toHaveBeenCalled();
    });

    it('hands the show back to the station when no host is named', async () => {
        // Absent means "whoever the station has on air", exactly as an empty brief means ordinary
        // rotation. Nothing is looked up, because there is nothing to look up.
        const { service, director, personas } = build({ order: onAirWith(3) });

        await service.recast({});

        expect(director.post).toHaveBeenCalledWith({ kind: 'recast', bind: {} });
        expect(personas.find).not.toHaveBeenCalled();
    });

    it('refuses a persona the station no longer has, rather than changing the show to nobody', async () => {
        // Unlike `putOnAir`, which takes an id on trust: refusing to go on air over a stale host
        // would be the station declining to broadcast. Nothing is at stake here but the request.
        const { service, director } = build({ order: onAirWith(3), persona: () => undefined });

        expect(await statusOf(service.recast({ personaId: 'gone' }))).toBe(404);
        expect(director.post).not.toHaveBeenCalled();
    });

    it('records the recast against the operator who asked for it', async () => {
        const { service, activity } = build({ order: onAirWith(3), persona: id => ({ id, label: 'The Pirate', kind: 'host' }) });

        await service.recast({ personaId: 'pirate' });

        expect(activity.record.mock.calls[0]![0]).toMatchObject({
            module: 'director',
            kind: 'air.recast',
            detail: expect.stringContaining('The Pirate'),
            actorId: 'actor-1',
        });
    });

    it('records the replan against the operator who asked for it', async () => {
        const { service, activity } = build({ order: onAirWith(3) });

        await service.replanOrder({});

        expect(activity.record.mock.calls[0]![0]).toMatchObject({
            module: 'director',
            kind: 'order.replanned',
            actorId: 'actor-1',
        });
    });

    // The rating is read as the order is DRAWN rather than stored on the lineup: the director owns
    // that document, and a copy of an opinion in it would be a second answer going stale the moment
    // the operator changed their mind.
    it('carries what the station thinks of each record, and says nothing about one the catalog has never seen', async () => {
        const order = new StationLineup({ name: 'Afternoons', mode: 'rotation', onEnd: 'extend', source: 'import' });
        order.append([
            { pluginId: 'p', externalId: 't0', title: 'Known', artists: ['X'], artist: 'X', trackId: 'trk_known' },
            { pluginId: 'p', externalId: 't1', title: 'Uningested', artists: ['Y'], artist: 'Y' },
        ]);
        const { service, tracks } = build({ order, ratings: { trk_known: 'disliked' } });

        const drawn = await service.getOrder();

        expect(tracks.catalogRowsByTrackId).toHaveBeenCalledWith(['trk_known']);
        expect(drawn.items.map(item => item.rating)).toEqual(['disliked', undefined]);
    });

    // What a console draws its links from. The uningested record is the case that matters: it has
    // no page to reach, and a row that offered one would be a link into a 404.
    it('names the artist and album behind a record it holds, and neither for one it does not', async () => {
        const order = new StationLineup({ name: 'Afternoons', mode: 'rotation', onEnd: 'extend', source: 'import' });
        order.append([
            { pluginId: 'p', externalId: 't0', title: 'Known', artists: ['X'], artist: 'X', trackId: 'trk_known' },
            { pluginId: 'p', externalId: 't1', title: 'Uningested', artists: ['Y'], artist: 'Y' },
        ]);
        const { service } = build({ order, ratings: { trk_known: 'liked' } });

        const drawn = await service.getOrder();

        expect(drawn.items[0]).toMatchObject({ artistId: 'art_trk_known', albumId: 'alb_trk_known' });
        expect(drawn.items[1]!.artistId).toBeUndefined();
        expect(drawn.items[1]!.albumId).toBeUndefined();
    });

    // A single ingested outside any release. The artist is still reachable and the album is not,
    // which is the one row where the two ids disagree.
    it('names an artist but no album for a record that belongs to no release', async () => {
        const order = new StationLineup({ name: 'Afternoons', mode: 'rotation', onEnd: 'extend', source: 'import' });
        order.append([{ pluginId: 'p', externalId: 't0', title: 'Loose', artists: ['X'], artist: 'X', trackId: 'trk_single' }]);
        const { service } = build({ order, ratings: { trk_single: 'neutral' } });

        const drawn = await service.getOrder();

        expect(drawn.items[0]).toMatchObject({ artistId: 'art_trk_single' });
        expect(drawn.items[0]!.albumId).toBeUndefined();
    });

    it('says which records the station mixed in, and nothing about the ones the playlist named', async () => {
        const order = new StationLineup({ name: 'Afternoons', mode: 'rotation', onEnd: 'extend', source: 'import' });
        const [anchor] = order.append([{ pluginId: 'p', externalId: 't0', title: 'Named', artists: ['X'], artist: 'X' }]);
        order.interleave([{ afterItemId: anchor!.id, track: { pluginId: 'p', externalId: 't1', title: 'Found', artists: ['Y'], artist: 'Y' } }]);
        const { service } = build({ order });

        const drawn = await service.getOrder();

        expect(drawn.items.map(item => item.mixedIn)).toEqual([undefined, true]);
        expect(drawn.items[0]).not.toHaveProperty('mixedIn');
    });

    // The picture a break wears is its KIND's, read as the order is drawn for the same reason the
    // rating above is: the station holds the picture and the document holds an id, so an operator
    // who replaces the weather picture sees the forecast already in the order wearing the new one.
    // The console and the phone draw this same field, and the player is given the same picture on
    // the commit pass, so all three agree about a row without any of them storing it.
    it('draws a break wearing the picture its kind was given, and nothing for a kind with none', async () => {
        const order = onAirWith(1);
        order.insertSegment('seg-weather', 1);
        order.insertSegment('seg-ident', 2);
        const { service } = build({
            order,
            segments: [
                { id: 'seg-weather', kind: 'weather', state: 'ready', label: 'The weather', source: 'library' },
                { id: 'seg-ident', kind: 'ident', state: 'ready', label: 'Ident', source: 'library' },
            ],
            breakArt: { weather: { id: 'art-weather' } },
        });

        const drawn = await service.getOrder();

        expect(drawn.items[1]).toMatchObject({ kind: 'segment', artworkUrl: 'art/art-weather/cover.png' });
        expect(drawn.items[2]!.artworkUrl).toBeUndefined();
    });

    // One read for the order, and one key per KIND rather than per break: a clock that alternates
    // records and forecasts would otherwise ask the same question of the same row a dozen times.
    it("asks for a kind's picture once, however many breaks of that kind the order holds", async () => {
        const order = onAirWith(1);
        order.insertSegment('seg-weather', 1);
        order.insertSegment('seg-weather-2', 2);
        const { service, art } = build({
            order,
            segments: [
                { id: 'seg-weather', kind: 'weather', state: 'ready', label: 'The weather', source: 'library' },
                { id: 'seg-weather-2', kind: 'weather', state: 'ready', label: 'The weather again', source: 'library' },
            ],
            breakArt: { weather: { id: 'art-weather' } },
        });

        const drawn = await service.getOrder();

        expect(art.findBySourceUrls).toHaveBeenCalledTimes(1);
        expect(art.findBySourceUrls).toHaveBeenCalledWith([breakArtKey('weather')]);
        expect(drawn.items.map(item => item.artworkUrl)).toEqual([undefined, 'art/art-weather/cover.png', 'art/art-weather/cover.png']);
    });

    // A picture is decoration and the running order is the thing an operator is standing at. Losing
    // the art table costs the row its picture and the console nothing else.
    it('still draws the order when the art table cannot be read', async () => {
        const order = onAirWith(1);
        order.insertSegment('seg-weather', 1);
        const { service } = build({
            order,
            segments: [{ id: 'seg-weather', kind: 'weather', state: 'ready', label: 'The weather', source: 'library' }],
            breakArt: { weather: { id: 'art-weather' } },
            artError: new Error('no database'),
        });

        const drawn = await service.getOrder();

        expect(drawn.items).toHaveLength(2);
        expect(drawn.items[1]).toMatchObject({ kind: 'segment', title: 'The weather' });
        expect(drawn.items[1]!.artworkUrl).toBeUndefined();
    });

    // The row still draws — it is in the order and the station will pass over it — and there is no
    // kind left to look a picture up by.
    it('draws a segment the library has lost without a picture', async () => {
        const order = onAirWith(1);
        order.insertSegment('seg-gone', 1);
        const { service } = build({ order, breakArt: { weather: { id: 'art-weather' } } });

        const drawn = await service.getOrder();

        expect(drawn.items[1]).toMatchObject({ segmentState: 'gone' });
        expect(drawn.items[1]!.artworkUrl).toBeUndefined();
    });

    it('draws an empty running order rather than a 404 when nothing is on', async () => {
        // Nothing on air is an ordinary state. The console shows an empty order and the operator
        // puts something on.
        const { service } = build();

        expect(await service.getOrder()).toMatchObject({ items: [] });
    });
});

describe('DirectorConsoleService building a running order from a chart', () => {
    const posted0 = (posted: DirectorCommand[]) => (posted[0]?.kind === 'putOnAir' ? posted[0] : undefined);
    const titles = (posted: DirectorCommand[]) => (posted0(posted)?.tracks ?? []).map(track => track.title);

    // A broadcast that is on air, for the ask stamped with it: see `AirChartJob.execute`, which
    // checks a press against whatever this same call answers by the time the job runs.
    const onAirWith = (count: number): StationLineup => {
        const order = new StationLineup({ name: 'Afternoons', mode: 'rotation', onEnd: 'extend', source: 'import' });
        order.append(
            Array.from({ length: count }, (_, index) => ({
                pluginId: 'p',
                externalId: `t${index}`,
                title: `T${index}`,
                artists: ['X'],
                artist: 'X',
            })),
        );
        return order;
    };

    const TOP_THREE = [
        { rank: 1, title: 'Glory Box', artist: 'Portishead' },
        { rank: 2, title: 'Windowlicker', artist: 'Aphex Twin' },
        { rank: 3, title: 'Teardrop', artist: 'Massive Attack' },
    ];

    describe('taking the ask, which is all airChart answers', () => {
        // Queued rather than done inline, because a chart is up to `MAX_CHART_ENTRIES` records and
        // each miss is a search across every provider. What is pinned here is the split: the two
        // refusals an operator can act on stay at the door, and nothing else does.

        it('queues the work and posts nothing itself', async () => {
            const { service, jobs, posted } = build({ chart: TOP_THREE });

            await service.airChart({ chartId: 'deadair.lastfm:top-100', chartOrder: 'ranked' });

            expect(jobs.send).toHaveBeenCalledWith('director.air_chart', { chartId: 'deadair.lastfm:top-100', chartOrder: 'ranked' });
            // The station is not put on air by the ask. The job does that, minutes later.
            expect(posted()).toEqual([]);
        });

        it('records the ask with the operator on it, since the outcome will carry nobody', async () => {
            const { service, activity } = build({ chart: TOP_THREE });

            await service.airChart({ chartId: 'deadair.lastfm:top-100' });

            expect(activity.record).toHaveBeenCalledWith(expect.objectContaining({ module: 'director', kind: 'air.chartRequested' }));
        });

        it('refuses an id that names no chart before queuing anything', async () => {
            const { service, jobs } = build({ chart: TOP_THREE });

            expect(await statusOf(service.airChart({ chartId: 'not-a-qualified-id' }))).toBe(422);
            expect(jobs.send).not.toHaveBeenCalled();
        });

        it('refuses a chart nothing could read before queuing anything', async () => {
            // `ChartsService` flattens every upstream failure to an empty list, so this is also a
            // plugin that is gone and one whose service refused. Cheap to know, so it stays at the
            // door rather than becoming a job that fails minutes later with nobody watching.
            const { service, jobs } = build({});

            expect(await statusOf(service.airChart({ chartId: 'deadair.lastfm:top-100' }))).toBe(422);
            expect(jobs.send).not.toHaveBeenCalled();
        });

        it('stamps the ask with the broadcast on air right now, so the job can tell a changeover from a stale press', async () => {
            const order = onAirWith(2);
            const { service, jobs } = build({ chart: TOP_THREE, order });

            await service.airChart({ chartId: 'deadair.lastfm:top-100' });

            expect(jobs.send).toHaveBeenCalledWith('director.air_chart', {
                chartId: 'deadair.lastfm:top-100',
                broadcastId: order.broadcastId,
            });
        });

        it('carries no broadcastId when the station is stood down at the press', async () => {
            const { service, jobs } = build({ chart: TOP_THREE });

            await service.airChart({ chartId: 'deadair.lastfm:top-100' });

            expect(jobs.send).toHaveBeenCalledWith('director.air_chart', { chartId: 'deadair.lastfm:top-100' });
        });
    });

    it('ends the broadcast on number one, because a countdown is what a chart show is', async () => {
        const { service, posted } = build({ chart: TOP_THREE });

        await service.putOnAir({ chartId: 'deadair.lastfm:top-100' });

        expect(titles(posted())).toEqual(['Teardrop', 'Windowlicker', 'Glory Box']);
    });

    it('walks the published document from the top when the operator asks for that instead', async () => {
        const { service, posted } = build({ chart: TOP_THREE });

        await service.putOnAir({ chartId: 'deadair.lastfm:top-100', chartOrder: 'ranked' });

        expect(titles(posted())).toEqual(['Glory Box', 'Windowlicker', 'Teardrop']);
    });

    it('resolves the names rather than binding them, since a chart carries no copy to play', async () => {
        // The whole reason this is not the playlist branch with a different fetch: an entry is a
        // title and an artist, so it has to be matched, looked up and ingested before it can air.
        const { service, resolver } = build({ chart: TOP_THREE });

        await service.putOnAir({ chartId: 'deadair.lastfm:top-100', chartOrder: 'ranked' });

        expect(resolver.resolve).toHaveBeenCalledWith(
            [
                { title: 'Glory Box', artist: 'Portishead' },
                { title: 'Windowlicker', artist: 'Aphex Twin' },
                { title: 'Teardrop', artist: 'Massive Attack' },
            ],
            expect.anything(),
            expect.objectContaining({ preference: ['deadair.lastfm'] }),
        );
    });

    it('seeds under NO_RULES, so a chart played twice in a week is not emptied by the repeat window', async () => {
        const { service, resolver } = build({ chart: TOP_THREE, settings: { 'rotation.repeatWindowDays': '30', 'rotation.maxPerArtist': '1' } });

        await service.putOnAir({ chartId: 'deadair.lastfm:top-100' });

        expect(resolver.resolve).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ repeatWindowDays: 0, artistCooldownMinutes: 0, maxPerArtist: 0 }),
            expect.anything(),
        );
    });

    it('records the chart as provenance, and says a chart is what built this', async () => {
        const { service, posted } = build({ chart: TOP_THREE });

        await service.putOnAir({ chartId: 'deadair.lastfm:top-100' });

        expect(posted0(posted())?.binding).toMatchObject({
            source: 'chart',
            sourceChartId: 'deadair.lastfm:top-100',
            // Split back out of the qualified id, so the desk gets the badge it draws for a playlist.
            sourcePluginId: 'deadair.lastfm',
        });
        // Nothing to pull more from: a chart is read once, so it never becomes a playlist binding.
        expect(posted0(posted())?.binding.sourcePlaylistId).toBeUndefined();
    });

    it('takes the broadcast’s name from the chart, not from the plugin that served it', async () => {
        const { service, posted } = build({ chart: TOP_THREE, chartMenu: [{ id: 'deadair.lastfm:top-100', name: 'Global Top 100' }] });

        await service.putOnAir({ chartId: 'deadair.lastfm:top-100' });

        expect(posted0(posted())?.binding.name).toBe('Global Top 100');
    });

    it('falls back to the plugin when the menu no longer lists that chart', async () => {
        const { service, posted } = build({ chart: TOP_THREE, chartMenu: [] });

        await service.putOnAir({ chartId: 'deadair.lastfm:top-100' });

        expect(posted0(posted())?.binding.name).toBe('From deadair.lastfm');
    });

    it('refuses a chart that could not be read rather than airing an empty order', async () => {
        // `ChartsService` flattens every upstream failure to an empty list, because a chart is
        // something to LOOK at. Airing one is the other thing.
        const { service, posted } = build({ chart: [] });

        expect(await statusOf(service.putOnAir({ chartId: 'deadair.lastfm:top-100' }))).toBe(422);
        expect(posted()).toHaveLength(0);
    });

    it('refuses an id that does not name a plugin and one of its charts', async () => {
        const { service } = build({ chart: TOP_THREE });

        expect(await statusOf(service.putOnAir({ chartId: 'top-100' }))).toBe(422);
    });

    it('names "rotation.discover" when that is what emptied the chart', async () => {
        // The state that reads as a broken plugin: the operator asked for a chart, a chart came
        // back, and every record on it was dropped for want of a lookup the station may not make.
        const { service } = build({ chart: TOP_THREE, resolve: () => [], settings: { 'rotation.discover': 'false' } });

        expect(await refusalOf(service.putOnAir({ chartId: 'deadair.lastfm:top-100' }))).toContain('rotation.discover');
    });

    it('blames the providers and the vetoes when discovery is on and nothing resolved anyway', async () => {
        const { service } = build({ chart: TOP_THREE, resolve: () => [] });

        const refusal = await refusalOf(service.putOnAir({ chartId: 'deadair.lastfm:top-100' }));

        // Asserted non-empty as well, because `refusalOf` answers with nothing for a call that did
        // NOT refuse, and "does not mention discovery" would then pass for a station that aired it.
        expect(refusal).not.toBe('');
        expect(refusal).not.toContain('rotation.discover');
    });

    it('drops what the period excludes before the picks are even resolved', async () => {
        const { service, resolver } = build({
            chart: [
                { rank: 1, title: 'Newer', artist: 'A', year: 2024 },
                { rank: 2, title: 'Anthem', artist: 'B', year: 1994 },
            ],
        });

        await service.putOnAir({ chartId: 'deadair.lastfm:top-100', eraFrom: 1990, eraTo: 1999 });

        expect(resolver.resolve).toHaveBeenCalledWith([{ title: 'Anthem', artist: 'B' }], expect.anything(), expect.anything());
    });

    it('is an ordinary rotation afterwards, so the hour past the chart is programmed as any other', async () => {
        const { service, posted } = build({ chart: TOP_THREE });

        await service.putOnAir({ chartId: 'deadair.lastfm:top-100' });

        expect(posted0(posted())?.binding).toMatchObject({ mode: 'rotation', onEnd: 'extend' });
    });
});

describe('DirectorConsoleService vetoing what the station has been forbidden', () => {
    /** A running order of records the catalog knows, so the veto has ids to judge them by. */
    const onAirWith = (count: number): StationLineup => {
        const order = new StationLineup({ name: 'Afternoons', mode: 'rotation', onEnd: 'extend', source: 'import' });
        order.append(
            Array.from({ length: count }, (_, index) => ({
                pluginId: 'p',
                externalId: `t${index}`,
                title: `T${index}`,
                artists: ['X'],
                artist: 'X',
                trackId: `trk_${index}`,
            })),
        );
        return order;
    };

    it('takes out every record the catalog now forbids, whatever level said so', async () => {
        // The point of going through `ratingsFor` rather than matching on the artist: the caller
        // says which records may not play and the veto never has to know whether it was the song,
        // the record, the lead artist or a guest credit that forbade them.
        const order = onAirWith(4);
        const { service } = build({ order, effectiveRatings: { trk_0: 0, trk_1: -1, trk_2: 0, trk_3: -1 } });

        await service.vetoDisliked('Grateful Dead');

        expect(order.all().map(item => (item.kind === 'track' ? item.track.externalId : ''))).toEqual(['t0', 't2']);
    });

    it('keeps a record the catalog has never heard of, because no opinion is not a veto', async () => {
        // `PickResolver.vet`'s own answer at the same fork. `trackId` is optional because a station
        // can air a record it has not ingested, and dropping those would empty an order the operator
        // built out of a provider playlist the catalog has not walked yet.
        const order = new StationLineup({ name: 'Afternoons', mode: 'rotation', onEnd: 'extend', source: 'import' });
        order.append([{ pluginId: 'p', externalId: 't0', title: 'T0', artists: ['X'], artist: 'X' }]);
        const { service, director } = build({ order, effectiveRatings: {} });

        await service.vetoDisliked('Grateful Dead');

        expect(order.all()).toHaveLength(1);
        expect(director.applyEdit).not.toHaveBeenCalled();
    });

    it('does nothing at all when the order holds nothing forbidden', async () => {
        // Nothing is waiting on this, so an order that is fine costs one read and no feed row. A
        // station where somebody rates a lot of records would otherwise fill the feed with edits
        // that changed nothing.
        const { service, director, activity } = build({ order: onAirWith(2), effectiveRatings: { trk_0: 0, trk_1: 1 } });

        await service.vetoDisliked('Grateful Dead');

        expect(director.applyEdit).not.toHaveBeenCalled();
        expect(activity.record).not.toHaveBeenCalled();
    });

    it('does nothing when the station is not airing anything', async () => {
        const { service, director } = build({ effectiveRatings: { trk_0: -1 } });

        await service.vetoDisliked('Grateful Dead');

        expect(director.applyEdit).not.toHaveBeenCalled();
    });

    it('never judges what has already been heard', async () => {
        // Asking the catalog about records that already aired spends a query on the one thing
        // nothing can be done about.
        const order = onAirWith(3);
        order.markAiring(order.nextPlanned(1)[0]!.id);
        const { service, candidates } = build({ order, effectiveRatings: { trk_1: -1 } });

        await service.vetoDisliked('Grateful Dead');

        expect(candidates.ratingsFor).toHaveBeenCalledWith(['trk_0', 'trk_1', 'trk_2']);
    });

    it('records one feed row naming what the station was told, not one per record', async () => {
        const order = onAirWith(3);
        const { service, activity } = build({ order, effectiveRatings: { trk_0: -1, trk_1: -1, trk_2: 0 } });

        await service.vetoDisliked('Grateful Dead');

        expect(activity.record).toHaveBeenCalledTimes(1);
        expect(activity.record.mock.calls[0]![0]).toMatchObject({
            module: 'director',
            kind: 'order.vetoDisliked',
            data: { forbidden: 'Grateful Dead', items: 2 },
        });
        expect(activity.record.mock.calls[0]![0]!.detail).toContain('Grateful Dead');
    });

    it('cuts the record on air, and only after the order has moved', async () => {
        // The order first, on the skip's argument: the cut advances the player to whatever is
        // queued next, so a cut that landed first could advance it onto another record the same
        // instruction has just forbidden.
        const order = onAirWith(3);
        order.markAiring(order.nextPlanned(1)[0]!.id);
        const { service, pusher, cutAgainst } = build({ order, airing: true, effectiveRatings: { trk_0: -1, trk_1: -1 } });

        await service.vetoDisliked('Grateful Dead');

        expect(pusher.skipCurrent).toHaveBeenCalledTimes(1);
        // The forbidden record still to come was already gone when the cut landed, so the player
        // cannot advance onto it.
        expect(cutAgainst[0]).toEqual(['airing', 'planned']);
    });

    it('leaves the record on air alone when it is not one of the forbidden ones', async () => {
        const order = onAirWith(3);
        order.markAiring(order.nextPlanned(1)[0]!.id);
        const { service, pusher } = build({ order, airing: true, effectiveRatings: { trk_0: 0, trk_2: -1 } });

        await service.vetoDisliked('Grateful Dead');

        expect(pusher.skipCurrent).not.toHaveBeenCalled();
    });

    it('cuts nothing when the transport says nothing is playing', async () => {
        const order = onAirWith(2);
        order.markAiring(order.nextPlanned(1)[0]!.id);
        const { service, pusher } = build({ order, airing: false, effectiveRatings: { trk_0: -1 } });

        await service.vetoDisliked('Grateful Dead');

        expect(pusher.skipCurrent).not.toHaveBeenCalled();
    });

    it('logs a cut the stream refused rather than failing the rating behind it', async () => {
        // The record is already out of the order everywhere the order could take it out, and the
        // operator's rating has already succeeded. Raising here would report a failure for
        // something that worked.
        const order = onAirWith(2);
        order.markAiring(order.nextPlanned(1)[0]!.id);
        const { service } = build({ order, airing: true, cutTakes: false, effectiveRatings: { trk_0: -1 } });

        await expect(service.vetoDisliked('Grateful Dead')).resolves.toBeUndefined();
    });

    it('cancels the reactor before it edits, like every other writer of what airs', async () => {
        // A commit pass may already have gathered its material and be suspended in a read. Only the
        // epoch reaches it, and a veto that posted without bumping it would let the pass commit the
        // record it just took out.
        const { service, director } = build({ order: onAirWith(2), effectiveRatings: { trk_0: -1 } });

        await service.vetoDisliked('Grateful Dead');

        expect(director.invalidate).toHaveBeenCalled();
    });
});

describe('DirectorConsoleService and a record left over from the last programme', () => {
    const scheduled = (placedBy: 'schedule' | 'operator' = 'schedule'): StationLineup => {
        const order = new StationLineup({ name: 'Breakfast', mode: 'rotation', onEnd: 'extend', source: 'import', slotId: 'morning', placedBy });
        order.append([{ pluginId: 'p', externalId: 't0', title: 'T0', artists: ['X'], artist: 'X' }]);
        return order;
    };

    // The item ids ARE the running order's, so a record on air that the order does not hold is
    // whatever the changeover let finish. That membership is the whole recognition.
    it('names a record on air that the new running order does not hold', () => {
        const { service } = build({ order: scheduled(), airing: true });

        expect(service.overrunning()).toEqual({ itemId: 'on-air', startedAt: 0, title: 'Echoes' });
    });

    it('names nothing once the record on air belongs to this programme', () => {
        const order = scheduled();
        const { service } = build({ order, airing: true, onAirId: order.all()[0]!.id });

        expect(service.overrunning()).toBeUndefined();
    });

    it('names nothing for a programme an operator put on, who chose to let the record finish', () => {
        const { service } = build({ order: scheduled('operator'), airing: true });

        expect(service.overrunning()).toBeUndefined();
    });

    it('names nothing when nothing is on air', () => {
        const { service } = build({ order: scheduled(), airing: false });

        expect(service.overrunning()).toBeUndefined();
    });

    it('cuts the record it was asked about', async () => {
        const { service, pusher } = build({ order: scheduled(), airing: true });

        expect(await service.cutOverrun('on-air')).toBe(true);
        expect(pusher.skipCurrent).toHaveBeenCalledTimes(1);
    });

    // The record may have ended on its own since the tick named it, and a cut then would take the
    // new programme's first record off air instead.
    it('cuts nothing when the record on air is no longer the one it was asked about', async () => {
        const { service, pusher } = build({ order: scheduled(), airing: true, onAirId: 'the-next-one' });

        expect(await service.cutOverrun('on-air')).toBe(false);
        expect(pusher.skipCurrent).not.toHaveBeenCalled();
    });
});

describe('DirectorConsoleService marking a change of programme', () => {
    // The order coming off, as the schedule left it: a block with its own host.
    const breakfast = () => {
        const lineup = new StationLineup({
            name: 'Breakfast',
            mode: 'rotation',
            onEnd: 'extend',
            source: 'import',
            personaId: 'p-dave',
            slotId: 'slot-breakfast',
            placedBy: 'schedule',
        });
        lineup.append([{ pluginId: 'p', externalId: 't0', title: 'Solid Air', artists: ['John Martyn'], artist: 'John Martyn' }]);
        return lineup;
    };

    it('asks for a changeover when the timetable moves from one block to the next', async () => {
        const { service, director } = build({ order: breakfast() });

        await service.putOnAir({ brief: 'the usual', personaId: 'p-ruth' }, { id: 'slot-afternoon', label: 'Afternoons' } as never);

        expect(director.requestBreak).toHaveBeenCalledWith(
            expect.objectContaining({
                kind: 'changeover',
                urgency: 'next',
                source: 'schedule',
                // The outgoing binding, read BEFORE the command replaced it: nothing else knows who
                // presented the show coming off.
                context: { outgoingPersonaId: 'p-dave', outgoingShow: 'Breakfast', incomingShow: 'Afternoons' },
            }),
        );
    });

    it('asks after the new order is in place, so the break belongs to the broadcast that airs it', async () => {
        const { service, director } = build({ order: breakfast() });
        const calls: string[] = [];
        vi.mocked(director.post).mockImplementation(async () => {
            calls.push('post');
            return undefined;
        });
        vi.mocked(director.requestBreak).mockImplementation(async () => {
            calls.push('request');
            return { accepted: true };
        });

        await service.putOnAir({ brief: 'the usual' }, { id: 'slot-afternoon', label: 'Afternoons' } as never);

        expect(calls).toEqual(['post', 'request']);
    });

    it('names no show starting when the timetable runs out into the sustaining source', async () => {
        const { service, director } = build({ order: breakfast() });

        await service.putOnAir({ name: 'Sustaining', brief: 'warm and unhurried' }, undefined, true);

        expect(director.requestBreak).toHaveBeenCalledWith(
            expect.objectContaining({ context: { outgoingPersonaId: 'p-dave', outgoingShow: 'Breakfast' } }),
        );
    });

    it('does not name an operator’s own programme as a show that ended', async () => {
        const handmade = new StationLineup({ name: 'Heavy metal hits', mode: 'rotation', onEnd: 'extend', source: 'import', placedBy: 'operator' });
        const { service, director } = build({ order: handmade });

        await service.putOnAir({ brief: 'the usual' }, { id: 'slot-afternoon', label: 'Afternoons' } as never);

        expect(director.requestBreak).toHaveBeenCalledWith(expect.objectContaining({ context: { incomingShow: 'Afternoons' } }));
    });

    it('stays silent when an operator puts something on by hand', async () => {
        const { service, director } = build({ order: breakfast(), slot: { id: 'slot-afternoon' } });

        await service.putOnAir({ brief: 'heavy metal hits' });

        expect(director.requestBreak).not.toHaveBeenCalled();
    });

    it('stays silent when there was nothing on air to change from', async () => {
        const { service, director } = build();

        await service.putOnAir({ brief: 'the usual' }, { id: 'slot-afternoon', label: 'Afternoons' } as never);

        expect(director.requestBreak).not.toHaveBeenCalled();
    });

    it('changes the programme over even when the changeover itself cannot be asked for', async () => {
        const { service, director, posted } = build({ order: breakfast() });
        vi.mocked(director.requestBreak).mockRejectedValue(new Error('the mailbox is shut'));

        // Named as the tick names it, from the slot's label.
        await expect(
            service.putOnAir({ name: 'Afternoons', brief: 'the usual' }, { id: 'slot-afternoon', label: 'Afternoons' } as never),
        ).resolves.toBeDefined();

        expect(posted()[0]).toMatchObject({ kind: 'putOnAir', binding: { name: 'Afternoons' } });
    });
});
