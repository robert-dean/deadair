// The reactor is the one thing here with a listener on the other end. What is
// tested is mostly restraint: it commits a few items and no more, it does not
// put a stood-down station back on air, and it does not queue a refill per
// rundown event. The stand-down case is the load-bearing one — an app that kept
// committing after Stop would have the station broadcasting a second after the
// operator stopped it.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';
import type { Container } from 'injectkit';
import type { PgBossJobBroker } from '@maroonedsoftware/jobbroker/pgboss';

import { COMMIT_LEAD, DirectorService } from '../../../src/modules/director/director.service.js';
import {
    StationLineup,
    isTrackItem,
    type StationLineupMode,
    type StationLineupOnEnd,
    type StationLineupSnapshot,
} from '../../../src/modules/director/station.lineup.js';
import { StationLineupRepository } from '../../../src/modules/director/station.lineup.repository.js';
import { PlayHistoryRepository } from '../../../src/modules/director/play.history.repository.js';
import { CandidatesRepository } from '../../../src/modules/director/candidates.repository.js';
import { StationAirRepository, type StationAir } from '../../../src/modules/director/station.air.repository.js';
import { settingsConfig } from '../../utils/settings.config.js';
import { ROTATION_KEYS } from '../../../src/modules/director/rotation.rules.js';
import { AIR_MODE_KEY, type AirMode } from '../../../src/modules/playout/air.mode.js';
import type { ActivityRecorder } from '../../../src/modules/activity/activity.recorder.js';
import type { AudienceWatch } from '../../../src/modules/playout/audience.watch.js';
import { Rundown, type RundownTrack } from '../../../src/modules/playout/rundown.js';
import { TrackResolver } from '../../../src/modules/playout/playout.capability.js';
import { TrackAudioService, bindingKey } from '../../../src/modules/playout/audio/track.audio.service.js';
import { TrackCachePlanner } from '../../../src/modules/playout/audio/track.cache.planner.js';
import { BreakPlanner } from '../../../src/modules/director/break.planner.js';
import { BreakRequestRepository } from '../../../src/modules/director/break.request.repository.js';
import type { StoredBreakRequest } from '../../../src/modules/director/break.request.js';
import { SegmentRepository, type Segment } from '../../../src/modules/render/segment.repository.js';
import { RENDER_PLUGIN_ID } from '../../../src/modules/render/segment.source.js';
import { StationIdentity } from '../../../src/modules/shared/station.identity.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

class StubResolver extends TrackResolver {
    async resolve(): Promise<string> {
        return 'https://example.test/audio.ogg';
    }
}

/** Break spacing is minutes of airtime, so a fixture record needs a length to be spaced against. */
const TRACK_MINUTES = 5;

const track = (externalId: string): RundownTrack => ({
    pluginId: 'deadair.spotify',
    externalId,
    title: `Track ${externalId}`,
    artists: ['An Artist'],
    durationMs: TRACK_MINUTES * 60_000,
});

/** A record the CATALOG holds, which is the only kind whose copies can be judged before its slot. */
const catalogued = (externalId: string): RundownTrack => ({ ...track(externalId), trackId: `track-${externalId}` });

interface Options {
    air?: Partial<StationAir>;
    items?: string[];
    mode?: StationLineupMode;
    onEnd?: StationLineupOnEnd;
    /** What the stored air mode says, if anything is stored at all. */
    airMode?: AirMode;
    /** What the segment library holds, for the items the order names by id. */
    segments?: Partial<Segment>[];
    /** The station has never been given anything to play. */
    noOrder?: boolean;
    /**
     * Track ids the catalog can still serve a copy of.
     *
     * `undefined` means every one of them, which is the ordinary station. A test naming a subset is
     * staging a benched copy: `CandidatesRepository.bindingsFor` excludes `missing_at` outright, so
     * a track missing from its answer is one no provider will serve.
     */
    servable?: string[];
    /**
     * External ids whose audio is already on this machine.
     *
     * `undefined` means all of them, which is the ordinary station once the ripener has run.
     * Naming a subset is staging a cold record: the director will not commit one whose bytes are
     * not here, and holds its slot rather than committing past it.
     */
    localAudio?: string[];
    /**
     * External ids the ripener has given up on: every copy benched, or a backoff that outlasts the
     * record's own slot. The director takes these out of the order before their slots arrive.
     */
    unfetchable?: string[];
    /**
     * Which segment promised which line, as `[itemId, segmentId]` pairs.
     *
     * Stands in for `segments.claims_item_id`: the repository answers with the breaks whose promise
     * named one of the lines being taken out.
     */
    claimedBy?: [string, string][];
    /** The station has a writer and a voice, so a requested break can actually be produced. */
    canTalk?: boolean;
    /** Requests already in flight, for the pass that places the ones whose audio has landed. */
    waiting?: StoredBreakRequest[];
}

function build(options: Options = {}) {
    const rundown = new Rundown(new StubResolver(), logger);

    const lineup = new StationLineup({
        name: 'Afternoons',
        mode: options.mode ?? 'rotation',
        onEnd: options.onEnd ?? 'extend',
        source: 'import',
    });

    let air: StationAir | undefined = {
        slot: 'main',
        active: true,
        ...options.air,
    };

    // The record, not the authority: the director holds the order and writes it here. The fake
    // hands back the same instance so a test can assert on what was written by reading it.
    const saved: number[] = [];
    // The snapshots as they were written, which is the only way to see a running order the director
    // REPLACED: `putOnAir` builds a new `StationLineup` (a new broadcast is a new object), so the
    // instance handed back by `load` above stops being the one on air the moment it is called.
    const snapshots: StationLineupSnapshot[] = [];
    const lineups = {
        load: vi.fn(async () => (options.noOrder ? undefined : lineup)),
        save: vi.fn(async (snapshot: StationLineupSnapshot) => {
            snapshots.push(snapshot);
            saved.push(snapshot.items.length);
        }),
    } as unknown as StationLineupRepository;

    const airRepository = {
        get: vi.fn(async () => air),
        standDown: vi.fn(async () => {
            air = air ? { ...air, active: false } : air;
        }),
        goOnAir: vi.fn(async () => {
            air = { slot: 'main', active: true };
        }),
    } as unknown as StationAirRepository;

    const history = { record: vi.fn(async () => {}) } as unknown as PlayHistoryRepository;

    // The air mode is a SETTING, and settings are a layer of the app's config now, so it reaches
    // the director and the audience gate through this rather than through a scoped repository.
    const station = settingsConfig(options.airMode === undefined ? {} : { [AIR_MODE_KEY]: options.airMode });

    // Real, over the fake repository: where a break belongs is BreakPlanner's own decision and is
    // tested there, and stubbing it here would leave the wiring — that the reactor plants at all,
    // and does it before committing — untested.
    // Nothing can write here, so it plants recorded idents: what this file is testing is that the
    // reactor plants at all and does it before committing, and the written path has its own tests
    // next door.
    const breaks = new BreakPlanner(
        {
            listReady: vi.fn(async () => [{ id: 'ident-1', kind: 'ident', state: 'ready', label: 'Ident', source: 'library' }]),
            // Only a requested break plans a row through this planner: the ident path above takes
            // what the library already holds.
            plan: vi.fn(async (input: Record<string, unknown>) => ({ id: 'planned-1', state: 'planned', source: 'render', ...input })),
            markFailed: vi.fn(async () => {}),
        } as unknown as SegmentRepository,
        // `canTalk` is for the request tests, which need a station that can actually produce the
        // break they are asking for. Everything else here plants recorded idents.
        { canWrite: () => options.canTalk ?? false } as never,
        { speaker: () => (options.canTalk ? { record: { id: 'deadair.kokoro' } } : undefined) } as never,
        { send: vi.fn(async () => {}) } as never,
        // The same config the director gets, so a clock band set in a test reaches the planner the
        // way it reaches it in the app: one settings layer, read by both.
        station.config,
        logger,
    );

    const library = new Map((options.segments ?? []).map(segment => [segment.id!, segment as Segment]));
    // A mutable stub rather than a frozen fake: two tests replace the lookup to hold the pass open
    // mid-commit, or to fail it, which is the only way to reach the window this class guards.
    const segmentStub = {
        findByIds: vi.fn(async (ids: readonly string[]) => new Map([...library].filter(([id]) => ids.includes(id)))),
        findById: vi.fn(async (id: string) => library.get(id)),
        markFailed: vi.fn(async () => {}),
        // Answers with what it was asked to reopen, which is what the real one returns: the rows it
        // actually moved back to `planned`.
        reopenClaims: vi.fn(async (itemIds: readonly string[]) =>
            (options.claimedBy ?? []).filter(([item]) => itemIds.includes(item)).map(([, segment]) => segment),
        ),
    };
    const segments = segmentStub as unknown as SegmentRepository;

    const candidates = {
        bindingsFor: vi.fn(
            async (trackIds: readonly string[]) =>
                new Map(
                    trackIds
                        .filter(trackId => options.servable === undefined || options.servable.includes(trackId))
                        .map(trackId => [trackId, { trackId, pluginId: 'deadair.spotify', externalId: trackId }]),
                ),
        ),
    } as unknown as CandidatesRepository;

    // Which records the station already has the audio for. Defaults to ALL of them, so the tests
    // that are about something else are not silently exercising the cold path; `localAudio` names
    // the external ids that are here for the tests that are about the gate itself.
    const readyFor = vi.fn(async (bindings: readonly { pluginId: string; externalId: string }[]) => {
        const here = options.localAudio;
        return new Set(bindings.filter(binding => here === undefined || here.includes(binding.externalId)).map(binding => bindingKey(binding)));
    });
    const trackAudio = { readyFor } as unknown as TrackAudioService;

    // The ripener. It reads the warm window and answers with the records whose audio is not coming;
    // the director is what acts on that, which is what these tests are about. `unfetchable` names
    // external ids, mapped to item ids here so a test can say which record the provider has lost.
    const ripen = vi.fn(async (order: StationLineup) => ({
        asked: 0,
        unfetchable: order
            .all()
            .filter(isTrackItem)
            .filter(item => (options.unfetchable ?? []).includes(item.track.externalId))
            .map(item => item.id),
    }));
    const cachePlanner = { ripen } as unknown as TrackCachePlanner;

    // What the station has been asked to say. In memory here: what these tests are about is the
    // director's own restraint — the cooldown, and declining while off air — rather than the SQL,
    // which `apps/api/scripts/break.request.smoke.ts` covers against the real database.
    const opened: { id: string; key?: string; at: number }[] = [];
    const requests = {
        open: vi.fn(async (request: { kind: string; urgency: string; source: string; key?: string }, state: string) => {
            const row = { id: `req-${opened.length + 1}`, ...request, state, at: Date.now() };
            opened.push({ id: row.id, ...(request.key === undefined ? {} : { key: request.key }), at: row.at });
            return row;
        }),
        acceptedSince: vi.fn(async (key: string, since: number) => opened.some(row => row.key === key && row.at >= since)),
        attachSegment: vi.fn(async () => {}),
        moveTo: vi.fn(async () => true),
        // What the commit pass drains. Named by a test that is staging a break already in flight.
        waiting: vi.fn(async () => options.waiting ?? []),
        findById: vi.fn(async () => undefined),
    };

    const scope = {
        get: vi.fn((token: unknown) =>
            token === BreakRequestRepository
                ? requests
                : token === StationLineupRepository
                  ? lineups
                  : token === StationAirRepository
                    ? airRepository
                    : token === SegmentRepository
                      ? segments
                      : token === BreakPlanner
                        ? breaks
                        : token === CandidatesRepository
                          ? candidates
                          : token === TrackAudioService
                            ? trackAudio
                            : token === TrackCachePlanner
                              ? cachePlanner
                              : history,
        ),
        disposeAsync: vi.fn(async () => {}),
    };
    const createScope = vi.fn(() => scope);
    const container = { createScopedContainer: createScope } as unknown as Container;

    // The singleton broker, which is what JobsModule documents for a non-request caller.
    const jobs = { send: vi.fn(async (_name: string, _payload: Record<string, unknown>) => 'job-1') };

    // A stub: what the gate does to the mount is PlayoutPusher's, and is tested there. The
    // director no longer tells it anything — it reads the same setting from the same config.
    const audience = {} as unknown as AudienceWatch;

    const activity = { record: vi.fn(async () => undefined) } as unknown as ActivityRecorder;

    const director = new DirectorService(
        rundown,
        audience,
        container,
        jobs as unknown as PgBossJobBroker,
        activity,
        new StationIdentity(),
        station.config,
        logger,
    );

    return {
        director,
        station,
        container,
        createScope,
        scope,
        rundown,
        readyFor,
        lineups,
        snapshots,
        breaks,
        segmentStub,
        candidates,
        lineup,
        saved: () => saved,
        jobs,
        history,
        airRepository,
        audience,
        activity,
        requests,
        seed: async () => lineup.append((options.items ?? ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']).map(track)),
        /** The same, with every record catalogued, so its copies can be judged before its slot. */
        seedCatalogued: async () => lineup.append((options.items ?? ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']).map(catalogued)),
        setAir: (next: StationAir | undefined) => {
            air = next;
        },
    };
}

beforeEach(() => {
    vi.clearAllMocks();
});

/** Let the pending microtasks of a commit pass settle. */
const settle = () => new Promise(resolve => setImmediate(resolve));

/** The running order by provider id, which is what makes an assertion about it readable. */
const idsOf = (items: readonly { externalId: string }[]) => items.map(item => item.externalId);

/**
 * One wake, with no side effect on the running order.
 *
 * `next()` on an empty queue announces a change and hands nothing back, which is
 * exactly what the pusher produces every couple of seconds on an idle station.
 */
const wake = async (rundown: Rundown) => {
    await rundown.next();
    await settle();
};

/**
 * Air the item at the head of the queue, and let the commit pass fill the slot behind it.
 *
 * At a `COMMIT_LEAD` of 1 the committed window is one item, so a scenario about two consecutive
 * items plays out across two boundaries rather than inside one pass. That is what the station
 * actually does — it is only the tests that used to be able to see three items at once.
 */
const airNext = async (rundown: Rundown) => {
    const pulled = await rundown.next();
    if (pulled) rundown.markAired(pulled.item.id);
    await settle();

    return pulled;
};

describe('DirectorService thinning the order before the slot arrives', () => {
    // The half that turns "silence at the boundary" into "rotation got thinner an hour ago". The
    // same judgement already ran at the commit window; running it over the WARM window is the whole
    // difference, because there is still an order in front of it for a refill to fill the gap.
    it('takes a record the ripener has given up on out of the order', async () => {
        const { director, lineup, seed } = build({ items: ['a', 'b', 'c'], unfetchable: ['b'] });
        await seed();

        await director.start();

        // Still `planned` either side of it: committing PREPARES the transport, and handing over is
        // the transport's own act. What matters here is the middle one.
        expect(lineup.all().map(item => item.state)).toEqual(['planned', 'unavailable', 'planned']);
    });

    // `unavailable` rather than `skipped`, because those are opposite facts on a page explaining a
    // gap: this one names a copy nothing will serve, which is the one an operator can act on.
    it("says so on the feed, in the station's own words", async () => {
        const { director, activity, seed } = build({ items: ['a', 'b'], unfetchable: ['b'] });
        await seed();

        await director.start();

        expect(activity.record).toHaveBeenCalledWith(expect.objectContaining({ module: 'director', kind: 'item.unavailable', severity: 'warn' }));
    });

    it('leaves the order alone when everything can be fetched', async () => {
        const { director, lineup, seed } = build({ items: ['a', 'b', 'c'] });
        await seed();

        await director.start();

        expect(lineup.all().every(item => item.state !== 'unavailable')).toBe(true);
    });
});

describe('DirectorService committing only what it has the audio for', () => {
    it('commits nothing while the next record is still being fetched', async () => {
        // The precondition the whole shape exists for: Liquidsoap's resolve should be a read from
        // this app, never a provider download inside the request it is waiting on.
        const { director, rundown, seed } = build({ items: ['a', 'b', 'c'], localAudio: [] });
        await seed();

        await director.start();

        expect(rundown.upcoming()).toHaveLength(0);
    });

    // The load-bearing half. Filtering would commit 'b' and 'c' and leave 'a' behind them, so an
    // operator's sequence would be rearranged by which downloads happened to finish first.
    it('stops at the first record it has not got rather than committing past it', async () => {
        const { director, rundown, seed } = build({ items: ['a', 'b', 'c'], localAudio: ['b', 'c'] });
        await seed();

        await director.start();

        expect(rundown.upcoming()).toHaveLength(0);
    });

    it('commits the head that is here and holds the slot of the record that is not', async () => {
        const { director, rundown, seed } = build({ items: ['a', 'b', 'c'], localAudio: ['a'] });
        await seed();

        await director.start();
        expect(idsOf(rundown.upcoming())).toEqual(['a']);

        // 'a' airs and 'b' does not take its place, because its bytes are not here. The slot is
        // HELD rather than skipped, so 'c' — which is here — does not jump the queue.
        await airNext(rundown);

        expect(idsOf(rundown.upcoming())).toEqual([]);
    });

    // A segment's readiness is `segments.state` and `toPlayerItems` SKIPS one that is not ready
    // rather than waiting: a break is disposable and a record is not.
    it('does not ask whether a segment has local audio', async () => {
        const { director, lineup, readyFor, seed } = build({
            items: ['a'],
            segments: [{ id: 'seg-1', kind: 'ident', state: 'ready', label: 'Ident', audioChecksum: 'x', audioExt: 'mp3' }],
        });
        await seed();
        lineup.insertSegment('seg-1', 0);

        await director.start();

        // The record behind the segment is asked about and the segment is not: a segment's
        // readiness is `segments.state` rather than anything on disk.
        expect(readyFor).toHaveBeenCalledWith([{ pluginId: 'deadair.spotify', externalId: 'a' }]);
    });

    // An unreachable database must not take the station off air within three items. The pass falls
    // back to what the tree did before the rule existed and lets the hand-over fetch.
    it('commits without checking when it cannot tell what is here', async () => {
        const { director, rundown, readyFor, seed } = build({ items: ['a', 'b', 'c'] });
        readyFor.mockRejectedValue(new Error('the pool is gone'));
        await seed();

        await director.start();

        expect(rundown.upcoming()).toHaveLength(COMMIT_LEAD);
    });
});

describe('DirectorService committing', () => {
    it('commits a few items and no more', async () => {
        // The lineup is the deep plan and the rundown is a window onto it. Committing
        // further ahead only takes items out of an operator's reach.
        const { director, rundown, seed } = build();
        await seed();

        await director.start();

        expect(rundown.upcoming()).toHaveLength(COMMIT_LEAD);
    });

    it('prepares what the transport has room for, and marks nothing itself', async () => {
        // There is no cursor to advance, and no hand-over to claim. Preparing is telling the
        // transport HOW to play what the order already says; handing over is the transport's own
        // act, and it marks it at the moment it happens. Two things used to claim that
        // transition and the order was whichever ran last.
        const { director, lineup, rundown, seed } = build();
        await seed();

        await director.start();

        expect(rundown.upcoming()).toHaveLength(COMMIT_LEAD);
        expect(lineup.all().every(item => item.state === 'planned')).toBe(true);
    });

    it('leaves the marking to the hand-over, where it is a fact', async () => {
        const { director, lineup, rundown, seed } = build();
        await seed();
        await director.start();

        const pulled = await rundown.next();

        expect(lineup.find(pulled!.item.id)?.state).toBe('handed');
    });

    it('refills the window as the player consumes it', async () => {
        const { director, rundown, seed } = build();
        await seed();
        await director.start();

        // The pusher takes one and the player confirms it: the rundown is a track
        // short, and the change event is what tells the director to top it back up.
        const pulled = await rundown.next();
        rundown.markAired(pulled!.item.id);
        await new Promise(resolve => setImmediate(resolve));

        expect(rundown.upcoming()).toHaveLength(COMMIT_LEAD);
    });

    it('does not commit anything for a station that was stood down', async () => {
        // The whole reason `active` is stored. An app that came back committing would
        // put a station on air that somebody deliberately stopped.
        const { director, rundown, seed } = build({ air: { active: false } });
        await seed();

        await director.start();

        expect(rundown.upcoming()).toHaveLength(0);
    });

    // A copy that fails to serve four times is benched, and every reader excludes on that from the
    // moment it happens. Without this the line sat in the order looking fine until the transport
    // reached it and could not resolve a URL — several minutes during which the station was still
    // planning around a record it could no longer play, and still allowed to promise it in a break.
    describe('a record whose copies have all been benched', () => {
        it('comes out of the running order at the commit pass rather than at its slot', async () => {
            const { director, lineup, rundown, seedCatalogued } = build({ items: ['a', 'b', 'c'], servable: ['track-a', 'track-c'] });
            await seedCatalogued();

            await director.start();
            // One boundary, so 'b' reaches the commit window and is judged there.
            await airNext(rundown);

            expect(lineup.all()[1]?.state).toBe('unavailable');
            expect(rundown.upcoming().map(item => item.externalId)).toEqual(['c']);
        });

        it('says so on the feed, because the station is narrowing its own rotation', async () => {
            const { director, rundown, activity, seedCatalogued } = build({ items: ['a', 'b'], servable: ['track-a'] });
            await seedCatalogued();

            await director.start();
            await airNext(rundown);

            expect(activity.record).toHaveBeenCalledWith(
                expect.objectContaining({ kind: 'item.unavailable', data: expect.objectContaining({ trackId: 'track-b' }) }),
            );
        });

        it('offers a break that promised it the chance to be written again', async () => {
            // "Coming up, X" is baked into audio that cannot be re-cut, so a break naming a record
            // that has just come out of the order has two futures: dropped at hand-over by the
            // claim check, or written again before its slot. This asks for the second.
            const { director, rundown, segmentStub, activity, seedCatalogued, lineup } = build({
                items: ['a', 'b', 'c'],
                servable: ['track-a', 'track-c'],
            });
            await seedCatalogued();
            const doomed = lineup.all()[1]!.id;
            segmentStub.reopenClaims.mockImplementation(async (itemIds: readonly string[]) => (itemIds.includes(doomed) ? ['seg-1'] : []));

            await director.start();
            // One boundary, so the doomed line reaches the commit window.
            await airNext(rundown);
            await new Promise(resolve => setImmediate(resolve));

            expect(segmentStub.reopenClaims).toHaveBeenCalledWith([doomed]);
            expect(activity.record).toHaveBeenCalledWith(expect.objectContaining({ kind: 'break.rewriting', data: { segmentIds: ['seg-1'] } }));
        });

        it('says nothing when no break had promised it', async () => {
            const { director, activity, seedCatalogued } = build({ items: ['a', 'b'], servable: ['track-a'] });
            await seedCatalogued();

            await director.start();
            await new Promise(resolve => setImmediate(resolve));

            expect(activity.record).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'break.rewriting' }));
        });

        it('takes the record out even when the break cannot be re-offered', async () => {
            // Best-effort by design: the break is no worse off than it was a moment ago, and a
            // failure here must not cost the pass that was taking a dead record out of the order.
            const { director, rundown, segmentStub, lineup, seedCatalogued } = build({
                items: ['a', 'b', 'c'],
                servable: ['track-a', 'track-c'],
            });
            await seedCatalogued();
            segmentStub.reopenClaims.mockRejectedValue(new Error('the segments table is gone'));

            await director.start();
            await airNext(rundown);
            await new Promise(resolve => setImmediate(resolve));

            expect(lineup.all()[1]?.state).toBe('unavailable');
        });

        it('asks about a batch once, and asks nothing at all about records the catalog does not hold', async () => {
            // A pick straight from a provider playlist has no `trackId` and no binding row to be
            // missing, so there is nothing to judge and it answers for itself at hand-over.
            const { director, candidates, seed } = build({ items: ['a', 'b', 'c'] });
            await seed();

            await director.start();

            expect(candidates.bindingsFor).not.toHaveBeenCalled();
        });
    });

    it('commits nothing when nothing is on air', async () => {
        const { director, rundown, setAir } = build();
        setAir(undefined);

        await director.start();

        expect(rundown.upcoming()).toHaveLength(0);
    });
});

describe('DirectorService reading the air mode', () => {
    it('reports the stored mode alongside what is on air', async () => {
        const { director, seed } = build({ airMode: 'always' });
        await seed();

        await director.start();

        expect(director.status().airMode).toBe('always');
    });

    it('reports airing for an audience when nothing is stored', async () => {
        const { director, seed } = build();
        await seed();

        await director.start();

        expect(director.status().airMode).toBe('audience');
    });

    it('notices a change made elsewhere without being told, and without re-reading anything', async () => {
        // The mode is a setting an operator can change from anywhere, and the console is not the
        // only writer this has to survive. It used to be re-read on the same throttle as
        // `station_air` and then pushed into the audience gate; now it is simply read from the
        // config, so there is no window in which this and the gate disagree about it.
        const { director, station, seed } = build();
        await seed();
        await director.start();

        expect(director.status().airMode).toBe('audience');

        station.set(AIR_MODE_KEY, 'always');

        // No `reload()`, no tick, nothing invalidated.
        expect(director.status().airMode).toBe('always');
    });

    it('falls back rather than throwing on a value nobody recognises', async () => {
        // Somebody typed into the settings table by hand. This is read on the path that decides
        // whether the station airs at all, so the safe direction is the default rather than an
        // exception out of a getter.
        const { director, station, seed } = build();
        await seed();
        await director.start();

        station.set(AIR_MODE_KEY, 'sometimes');

        expect(director.status().airMode).toBe('audience');
    });
});

describe('DirectorService noticing the row', () => {
    it('picks up a station switched on out of band, without being told', async () => {
        // Checking a remembered `active` flag before reading the row means a station
        // that was off when this process started can never notice being switched on
        // by anything that did not call in — a scheduler, a second process, an
        // operator editing the row. Caught by a live run: the director sat idle while
        // station_air said it was on air.
        const { director, rundown, setAir, seed } = build({ air: { active: false } });
        await seed();
        await director.start();
        expect(rundown.upcoming()).toHaveLength(0);

        setAir({ slot: 'main', active: true });
        await wake(rundown);

        expect(rundown.upcoming().length).toBeGreaterThan(0);
        expect(director.status().active).toBe(true);
    });

    it('goes off air when the row says so, without being told either', async () => {
        const { director, rundown, setAir, seed } = build();
        await seed();
        await director.start();
        expect(rundown.upcoming()).toHaveLength(COMMIT_LEAD);

        setAir({ slot: 'main', active: false });
        // Past the throttle, because this station IS on air and a busy director reads the row
        // once every few seconds rather than on every wake.
        vi.setSystemTime(Date.now() + 10_000);
        await wake(rundown);

        expect(director.status().active).toBe(false);
    });
});

// Committing a line is a promise; only the player can say it aired. A retraction is where the two
// come apart, and without a correction the cursor has already counted lines nobody heard: they sit
// behind it, nothing offers them again, and every editor refuses them as already-aired. That is
// planned programming lost silently, which is the whole of bug 4.
describe('DirectorService reclaiming what was retracted', () => {
    it('offers again the lines a replacement took back', async () => {
        const { director, rundown, seed } = build();
        await seed();
        await director.start();
        expect(idsOf(rundown.upcoming())).toEqual(['a']);
        // Handed to the player, and heard by nobody.
        await rundown.next();

        // What `putOnAir` does: retract the tail, leave the station on air.
        rundown.retract();
        await settle();

        // The same line, not the one after it. Without the reclaim it would sit spent in the
        // order, where nothing would ever offer it and no listener ever heard it.
        expect(idsOf(rundown.upcoming())).toEqual(['a']);
    });

    it('does not replay the line that was on air, which the listener did hear', async () => {
        const { director, rundown, lineup, seed } = build();
        await seed();
        await director.start();

        // Hand one over and let the player confirm it, so there is a line that genuinely aired.
        const pulled = await rundown.next();
        rundown.markAired(pulled!.item.id);
        expect(rundown.nowPlaying()?.item.externalId).toBe('a');

        // A stand-down drops what is airing too, unlike a replacement.
        rundown.reset();
        await settle();

        // 'a' aired, so it stays played: offering it again would replay a record the listener
        // was in the middle of. 'b' and 'c' were promised and not heard, so they come back.
        expect(
            lineup
                .all()
                .slice(0, 3)
                .map(item => item.state),
        ).toEqual(['played', 'planned', 'planned']);
    });

    it('leaves alone what the player is merely holding', async () => {
        // The hazard that makes this event-driven rather than measured from the rundown. An item
        // handed over is the ordinary steady state, not a dropped one: the pusher runs a lead ahead
        // of the listener by design. Treating those as unheard commits them twice and the listener
        // hears the record twice.
        const { director, rundown, lineup, seed } = build();
        await seed();
        await director.start();

        // 'a' is handed over and merely held: nothing has confirmed it on air.
        await rundown.next();
        await settle();

        // It stays exactly where it is. Nothing is reclaimed and nothing is offered twice — and
        // at a lead of one, nothing else is committed either, because the slot is still spent.
        expect(idsOf(rundown.upcoming())).toEqual(['a']);
        expect(
            lineup
                .all()
                .slice(0, 3)
                .map(item => item.state),
        ).toEqual(['handed', 'planned', 'planned']);
    });

    it('recognises what a previous process left on air, rather than standing the clock down', async () => {
        // The reason item ids are the ORDER's, and the case the merge exists for. A restart used
        // to come back unable to name what Liquidsoap was still producing, log a diagnostic about
        // an id it had never handed over, and stand its clock down over a record a listener was in
        // the middle of.
        const { director, rundown, lineup, seed } = build();
        await seed();
        // The row as a crashed process left it: one item handed over, and confirmed on air.
        const [wasAiring] = lineup.nextPlanned(1);
        lineup.markHanded(wasAiring!.id);
        lineup.markAiring(wasAiring!.id);

        await director.start();
        vi.mocked(logger.warn).mockClear();
        rundown.reconcile({ queued: 0, ready: true, onAir: wasAiring!.id });

        expect(rundown.nowPlaying()?.item.id).toBe(wasAiring!.id);
        expect(logger.warn).not.toHaveBeenCalled();
    });
});

// `busy` and `pending` used to hand-roll this: a pass in progress set a flag, and the tail of that
// pass re-fired. The mailbox does it by construction, and these are what say so, because deleting a
// guard is only safe if something proves the property it was guarding.
describe('DirectorService committing under a burst of events', () => {
    it('commits each line once however many events arrive at once', async () => {
        const { director, rundown, seed } = build();
        await seed();
        await director.start();

        // Several per boundary is the real rate: the item handed over and the item confirmed on
        // air are two events milliseconds apart, and the pusher reconciles on top of that.
        for (let index = 0; index < 8; index++) rundown.prepare([]);
        // Nothing to prepare announces nothing, so the burst is staged the way a real one arrives:
        // through the player consuming what it was given.
        await rundown.next();
        await settle();

        const ids = idsOf(rundown.upcoming());
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids).toEqual(['a']);
    });

    it('does not run two passes at once', async () => {
        // The hazard the flags existed for: two passes reading the same depth and both committing
        // against it, which hands the player twice the lead and plays a record twice.
        const { director, rundown, segmentStub, lineup, seed } = build({
            segments: [{ id: 'seg-1', kind: 'ident', state: 'ready', label: 'Ident', source: 'library' }],
        });
        await seed();
        lineup.insertSegment('seg-1', 0);

        let inFlight = 0;
        let overlapped = false;
        segmentStub.findByIds = vi.fn(async () => {
            inFlight += 1;
            if (inFlight > 1) overlapped = true;
            await new Promise(resolve => setImmediate(resolve));
            inFlight -= 1;
            return new Map<string, Segment>();
        });

        await director.start();
        for (let index = 0; index < 5; index++) await rundown.next();
        await settle();

        expect(overlapped).toBe(false);
    });
});

describe('DirectorService standing down', () => {
    it('stops committing when the transport is stopped', async () => {
        // `PlayoutService.stop` resets the rundown. If the director did not hear that,
        // its next pass would refill the running order and the station would be back
        // on air a second after the operator stopped it.
        const { director, rundown, seed } = build();
        await seed();
        await director.start();

        rundown.reset();
        await new Promise(resolve => setImmediate(resolve));

        expect(rundown.upcoming()).toHaveLength(0);
        expect(director.status().active).toBe(false);
    });

    it('does not resume in the window before the stand-down has been written', async () => {
        // `Rundown.reset` calls its listeners synchronously, so there is a moment
        // between Stop and the row saying so. A wake landing there reads the OLD row,
        // sees `active: true`, and puts the station straight back on air.
        const { director, rundown, airRepository, seed } = build();
        await seed();
        await director.start();

        // A write that has not landed yet, exactly as a real one has not.
        let release = () => {};
        vi.mocked(airRepository.standDown).mockImplementationOnce(
            async () =>
                new Promise<void>(resolve => {
                    release = resolve;
                }),
        );

        rundown.reset();
        await wake(rundown);

        expect(rundown.upcoming()).toHaveLength(0);
        expect(director.status().active).toBe(false);

        release();
    });

    it('records the stand-down, so a restart stays down', async () => {
        const { director, rundown, airRepository, seed } = build();
        await seed();
        await director.start();

        rundown.reset();
        await new Promise(resolve => setImmediate(resolve));

        expect(airRepository.standDown).toHaveBeenCalled();
    });

    it('tells the activity feed once, on the edge', async () => {
        // The stand-down path is idempotent and reached from two directions, so without the edge
        // the feed would carry a line every time anything asked a stopped station to stop.
        const { director, rundown, activity, seed } = build();
        await seed();
        await director.start();

        rundown.reset();
        await settle();
        rundown.reset();
        await settle();

        const record = activity.record as unknown as ReturnType<typeof vi.fn>;
        expect(record.mock.calls.filter(call => call[0]?.kind === 'air.off')).toHaveLength(1);
    });

    it('says it in the log as well, which is what still works when the database does not', async () => {
        const { director, rundown, seed } = build();
        await seed();
        await director.start();

        rundown.reset();
        await settle();

        const said = (logger.info as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(call =>
            String(call[0]).includes('stood the station down'),
        );
        expect(said).toHaveLength(1);
    });

    it('says nothing to the feed when the write did not land', async () => {
        // The intent stands even when the row does not — the process stays off air — but a feed
        // saying the station stopped while the station does not know it stopped is worse than a
        // feed missing a line.
        const { director, rundown, airRepository, activity, seed } = build();
        await seed();
        await director.start();
        vi.mocked(airRepository.standDown).mockRejectedValueOnce(new Error('no connection'));

        rundown.reset();
        await settle();

        const record = activity.record as unknown as ReturnType<typeof vi.fn>;
        expect(record.mock.calls.filter(call => call[0]?.kind === 'air.off')).toHaveLength(0);
    });

    it('ignores a retraction, which is not a stand-down', async () => {
        // A retraction announces a reset too, but the station is still on air playing what it was
        // playing; only what comes after it changed.
        const { director, rundown, seed } = build();
        await seed();
        await director.start();

        rundown.retract();
        await new Promise(resolve => setImmediate(resolve));

        expect(director.status().active).toBe(true);
    });
});

describe('DirectorService history', () => {
    it('records what the player confirmed, not what it was handed', async () => {
        // The two are a lead apart: the item being committed now is three tracks from
        // being heard, and history that recorded it would suppress a song nobody played.
        const { director, rundown, history, seed } = build();
        await seed();
        await director.start();

        const pulled = await rundown.next();
        expect(history.record).not.toHaveBeenCalled();

        rundown.markAired(pulled!.item.id);
        await new Promise(resolve => setImmediate(resolve));

        expect(history.record).toHaveBeenCalledOnce();
        expect(vi.mocked(history.record).mock.calls[0]![0]!.item.externalId).toBe('a');
    });

    it('reports a catch-up as ONE event, however many items it wrote off', async () => {
        // Found by running it: a stream that dropped while the station was driving wrote off
        // twenty items and the feed said nothing at all. One line per item would have been the
        // other failure — twenty rows burying everything else on the page.
        const { director, rundown, lineup, activity, seed } = build();
        await seed();
        await director.start();

        // The player reports an item two further down than the one it was handed: everything
        // between was committed and never aired, which is what a failed decode or a dropped
        // stream looks like from here. Prepared by hand because at a lead of one the director
        // commits only the head, and this is a reading about something past it.
        const later = lineup.all()[2]!;
        rundown.prepare([{ id: later.id, pluginId: 'deadair.spotify', externalId: 'c', title: 'c', artists: [] }]);
        await rundown.next();
        rundown.markAired(later.id);
        await settle();

        const record = activity.record as unknown as ReturnType<typeof vi.fn>;
        const caughtUp = record.mock.calls.filter(call => call[0]?.kind === 'order.caughtUp');
        expect(caughtUp).toHaveLength(1);
        expect(caughtUp[0]![0]).toMatchObject({ severity: 'warn', data: { passedOver: 2 } });
    });

    it('says nothing about an ordinary boundary', async () => {
        // Every track start would otherwise write a row saying nothing happened.
        const { director, rundown, activity, seed } = build();
        await seed();
        await director.start();

        const first = await rundown.next();
        rundown.markAired(first!.item.id);
        await settle();

        const record = activity.record as unknown as ReturnType<typeof vi.fn>;
        expect(record.mock.calls.filter(call => call[0]?.kind === 'order.caughtUp')).toHaveLength(0);
    });
});

describe('DirectorService refilling', () => {
    it('sends one refill when the tail runs short, however many events arrive', async () => {
        // A burst of rundown changes would otherwise queue a dozen identical jobs for
        // one shortfall.
        const { director, rundown, jobs, seed } = build({ items: ['a', 'b', 'c', 'd'] });
        await seed();
        await director.start();

        for (let index = 0; index < 3; index++) {
            const pulled = await rundown.next();
            if (pulled) rundown.markAired(pulled.item.id);
            await new Promise(resolve => setImmediate(resolve));
        }

        expect(vi.mocked(jobs.send).mock.calls.filter(call => call[0] === 'director.extend_lineup')).toHaveLength(1);
    });

    it('never refills a setlist, which is finite on purpose', async () => {
        const { director, jobs, seed } = build({ items: ['a', 'b'], mode: 'setlist' });
        await seed();

        await director.start();

        expect(jobs.send).not.toHaveBeenCalled();
    });
});

describe('DirectorService at the end of a lineup', () => {
    it('offers a setlist again once it has been heard, rather than while it is still in hand', async () => {
        // The old shape wrapped an INDEX, so a two-item setlist against a lead of three handed
        // the player 'a' twice in one batch. Wrapping is now a state put back, so an item still
        // with the player cannot be offered again — and the setlist repeats when it is actually
        // over, which is what `on_end: 'repeat'` was always meant to mean.
        const { director, rundown, lineup, seed } = build({ items: ['a', 'b'], mode: 'setlist', onEnd: 'repeat' });
        await seed();

        await director.start();
        expect(idsOf(rundown.upcoming())).toEqual(['a']);

        // Both are handed over, then both air. Everything BEHIND the record now playing is
        // offered again; the one still airing is not, because a listener is in the middle of it.
        for (let index = 0; index < 2; index++) {
            const pulled = await rundown.next();
            rundown.markAired(pulled!.item.id);
            await settle();
        }

        // 'a' is behind the listener, so it is offered again and prepared for the player. 'b' is
        // not, because they are in the middle of it.
        expect(idsOf(rundown.upcoming())).toEqual(['a']);
        expect(lineup.all().map(item => item.state)).toEqual(['planned', 'airing']);
    });

    it('stands the station down when the running order says to stop', async () => {
        // Reached once the last item is with the player rather than at the moment it is prepared:
        // handing over is what spends it, and the transport is what does that.
        const { director, rundown, seed } = build({ items: ['a'], mode: 'feature', onEnd: 'stop' });
        await seed();

        await director.start();
        await rundown.next();
        await new Promise(resolve => setImmediate(resolve));

        expect(director.status().active).toBe(false);
        expect(rundown.upcoming()).toHaveLength(0);
    });

    // `on_end: 'resume'` and `on_end: 'rotation'` are gone with the library. Both named another
    // STORED lineup for the station to fall back to, and there is no longer one to name: what is
    // on air is built when it goes on air. `stop` above is what a finite programme does now.
});

describe('DirectorService resuming what it was stopped on', () => {
    // Stop deliberately leaves the running order alone, every item still saying where it got to.
    // Until this there was no way to pick that up: the only route back on air replaced it.
    it('goes back on air on the order it already has', async () => {
        const { director, rundown, airRepository, seed } = build({ air: { active: false } });
        await seed();
        await director.start();
        expect(rundown.upcoming()).toHaveLength(0);

        const result = await director.resumeAir();

        expect(result).toEqual({ resumed: true });
        expect(airRepository.goOnAir).toHaveBeenCalled();
        expect(idsOf(rundown.upcoming())).toEqual(['a']);
    });

    // The same broadcast, not a new one: `putOnAir` mints an id and this does not, so the hour
    // either side of an operator's Stop is one programme rather than two.
    it('keeps the broadcast it was stopped on', async () => {
        const { director, lineup, seed } = build({ air: { active: false } });
        await seed();
        await director.start();
        const before = lineup.toSnapshot().broadcastId;

        await director.resumeAir();

        expect(lineup.toSnapshot().broadcastId).toBe(before);
    });

    // A station switched on and holding nothing is the state the mount lease exists to avoid
    // asserting, so this refuses rather than reporting a station on air with nothing to play.
    it('refuses when there is no running order left to resume', async () => {
        const { director, seed } = build({ air: { active: false }, noOrder: true });
        await seed();
        await director.start();

        expect(await director.resumeAir()).toEqual({ resumed: false });
    });
});

describe('DirectorService going on air', () => {
    it('replaces the running order with what it was handed, and retracts the old one', async () => {
        const { director, rundown, seed, snapshots } = build();
        await seed();
        await director.start();
        expect(idsOf(rundown.upcoming())).toEqual(['a']);

        await director.post({
            kind: 'putOnAir',
            binding: { name: 'Something else', mode: 'rotation', onEnd: 'extend', source: 'import' },
            tracks: [track('x'), track('y')],
        });

        // Nothing of the previous programme survives behind the record still playing. That is
        // the retraction, and it is why a change of lineup used to leak records into the new show.
        expect(idsOf(rundown.upcoming())).toEqual(['x']);
        expect(snapshots.at(-1)?.items.map(item => item.kind === 'track' && item.track.externalId)).toEqual(['x', 'y']);
        expect(director.status().name).toBe('Something else');
    });

    it('asks for the new records to be described, rather than waiting for the next quarter hour', async () => {
        // The enrichment walk already puts what the station is about to play in front of the rest of
        // the catalog; this is what stops the first run that does so being up to fifteen minutes
        // away. An imported provider playlist is the case that needs it most, since nothing ever
        // extends one.
        const { director, jobs, seed } = build();
        await seed();
        await director.start();
        jobs.send.mockClear();

        await director.post({
            kind: 'putOnAir',
            binding: { name: 'Something else', mode: 'rotation', onEnd: 'extend', source: 'import' },
            tracks: [track('x'), track('y')],
        });

        expect(jobs.send.mock.calls.filter(call => call[0] === 'catalog.enrich')).toHaveLength(1);
    });

    it('asks again when a refill appends more, since that is where a discovered record arrives', async () => {
        // `PickResolver` looks a pick up at a provider and ingests it INSIDE the refill, so the
        // records that most need describing are the ones this command carries.
        const { director, jobs, seed } = build();
        await seed();
        await director.start();
        jobs.send.mockClear();

        await director.post({ kind: 'appendTracks', tracks: [track('x'), track('y')] });

        expect(jobs.send.mock.calls.filter(call => call[0] === 'catalog.enrich')).toHaveLength(1);
    });

    it('does not let a broker that will not take the send cost the station its running order', async () => {
        const { director, jobs, seed, lineup } = build();
        await seed();
        await director.start();
        jobs.send.mockRejectedValue(new Error('the broker is not available here'));

        await director.post({ kind: 'appendTracks', tracks: [track('x'), track('y')] });

        // The append landed. Nothing reads the enrichment send to decide anything and the cron is
        // still there, so a lost one costs a quarter hour and nothing else.
        expect(lineup.all().some(item => item.kind === 'track' && item.track.externalId === 'x')).toBe(true);
    });

    it('starts a NEW broadcast, so what aired before it is not filed under what is on now', async () => {
        // The whole point of the id: `play_history`, `segment_events`, `script_history` and
        // `station_events` are all stamped with it, so a running order that kept the previous
        // broadcast's identity would file an evening's rows under a show that had already ended.
        const { director, lineup, seed, snapshots } = build();
        await seed();
        await director.start();

        // Off the seeded order, which is the one the director loaded: nothing has been persisted
        // yet on a boot that changed nothing, and the throttle means that is the ordinary case.
        const before = lineup.toSnapshot().broadcastId;

        await director.post({
            kind: 'putOnAir',
            binding: { name: 'Something else', mode: 'rotation', onEnd: 'extend', source: 'import' },
            tracks: [track('x'), track('y')],
        });

        const after = snapshots.at(-1)?.broadcastId;
        expect(before).toBeDefined();
        expect(after).toBeDefined();
        expect(after).not.toBe(before);
    });

    it('switches the station on, so a restart comes back to it', async () => {
        const { director, airRepository, seed } = build({ air: { active: false } });
        await seed();
        await director.start();

        await director.post({
            kind: 'putOnAir',
            binding: { name: 'Afternoons', mode: 'rotation', onEnd: 'extend', source: 'import' },
            tracks: [track('x')],
        });

        expect(airRepository.goOnAir).toHaveBeenCalled();
        expect(director.status().active).toBe(true);
    });
});

// A lineup line can be a segment: an ident, a stinger, a talk break. The director is the only
// thing that turns one into something the player can be handed, and the rule it enforces is the
// one the whole design rests on — a segment that is not ready is SKIPPED, never waited for.
describe('DirectorService committing segments', () => {
    const READY = { id: 'seg-1', kind: 'ident', state: 'ready' as const, label: 'Top of the hour', source: 'library' };

    it('commits a ready segment as an ordinary item, so nothing downstream has to know what it is', async () => {
        const { director, lineup, rundown, seed } = build({ items: ['a', 'b'], segments: [READY] });
        await seed();
        lineup.insertSegment('seg-1', 0);

        await director.start();
        await settle();

        const committed = rundown.upcoming();
        expect(committed[0]).toMatchObject({ pluginId: RENDER_PLUGIN_ID, externalId: 'seg-1', title: 'Top of the hour' });
        // Empty rather than the station's name: `itemAnnotations` drops an empty value, so the
        // mount reads "Top of the hour" instead of "Top of the hour - Deadair".
        expect(committed[0]?.artists).toEqual([]);
    });

    it('skips a segment that has no audio yet rather than holding the slot open', async () => {
        const { director, lineup, rundown, seed } = build({
            items: ['a', 'b', 'c'],
            segments: [{ id: 'seg-1', kind: 'talkbreak', state: 'planned', label: 'A talk break', source: 'render' }],
        });
        await seed();
        lineup.insertSegment('seg-1', 0);

        await director.start();
        await settle();

        // The segment is at the head and is passed over, so the window fills with the record
        // behind it instead of being left empty. A skipped segment costs the running order
        // nothing at all, not even until the next reconcile.
        expect(rundown.upcoming().map(item => item.externalId)).toEqual(['a']);
    });

    // The lineup names it and the library no longer holds it: same outcome as one that is not
    // ready, and distinguishable only in the log.
    it('skips a segment the library has lost', async () => {
        const { director, lineup, rundown, seed } = build({ items: ['a', 'b'], segments: [] });
        await seed();
        lineup.insertSegment('seg-1', 1);

        await director.start();
        await settle();

        expect(rundown.upcoming().every(item => item.pluginId !== RENDER_PLUGIN_ID)).toBe(true);
    });

    // A break saying "coming up, X" made a statement about the future, minutes before it is spoken,
    // out of audio that cannot be re-cut. These are the two ends of checking it came true.
    describe('and the forward claim one made', () => {
        /** A ready break whose words named a particular line as coming up next. */
        const promising = (claimsItemId: string) => ({
            id: 'seg-1',
            kind: 'talkbreak' as const,
            state: 'ready' as const,
            label: 'Coming up',
            source: 'render',
            claimsItemId,
        });

        /** The break, its place in the order, and the line its words named. */
        const withClaim = async (claimed: (nextLineId: string) => string) => {
            const harness = build({ items: ['a', 'b'], segments: [] });
            await harness.seed();
            // At the head, because the committed window is one item: a break the pass never
            // reaches is not a test of the claim check.
            harness.lineup.insertSegment('seg-1', 0);

            const nextLine = harness.lineup.all()[1]!;
            const segment = promising(claimed(nextLine.id));
            harness.segmentStub.findByIds = vi.fn(async (ids: readonly string[]) =>
                ids.includes('seg-1') ? new Map([['seg-1', segment as never]]) : new Map(),
            );

            return harness;
        };

        it('airs a break whose promise the order still keeps', async () => {
            // The case that must not regress: a guard dropping every break is indistinguishable
            // from a station that never talks.
            const { director, rundown } = await withClaim(nextLineId => nextLineId);

            await director.start();
            await settle();

            expect(rundown.upcoming().some(item => item.externalId === 'seg-1')).toBe(true);
        });

        it('drops a break the order has moved under', async () => {
            // It promised a line that is no longer the next record: an operator moved it, a request
            // went in, the resolver dropped the pick. Silence on one boundary beats a wrong fact.
            const { director, rundown } = await withClaim(() => 'a-line-that-has-since-moved');

            await director.start();
            await settle();

            expect(rundown.upcoming().every(item => item.externalId !== 'seg-1')).toBe(true);
            // And the order does not lose its lead for it, exactly as with a segment that is not
            // ready: it goes through the same branch, and the record behind it comes in on the
            // segment slack rather than waiting for the next pass.
            expect(rundown.upcoming().map(item => item.externalId)).toEqual(['a']);
        });

        it('leaves a break that promised nothing alone', async () => {
            const { director, lineup, rundown, seed } = build({
                items: ['a', 'b'],
                segments: [{ id: 'seg-1', kind: 'talkbreak', state: 'ready', label: 'Back-announce', source: 'render' }],
            });
            await seed();
            lineup.insertSegment('seg-1', 1);

            await director.start();
            await settle();

            expect(rundown.upcoming().some(item => item.externalId === 'seg-1')).toBe(true);
        });
    });

    // The same guard in the other dimension. A break saying "it's just after nine" is overtaken by
    // the clock the way one saying "coming up, X" is overtaken by an edit, and the words are equally
    // un-recuttable once rendered.
    describe('and the time a break claimed', () => {
        /** A ready break whose words are only true inside a window. */
        const timed = async (claimsTime: { from: number; until: number }) => {
            const harness = build({ items: ['a', 'b'], segments: [] });
            await harness.seed();
            harness.lineup.insertSegment('seg-1', 1);

            const segment = { id: 'seg-1', kind: 'talkbreak', state: 'ready', label: 'Time check', source: 'render', claimsTime };
            harness.segmentStub.findByIds = vi.fn(async (ids: readonly string[]) =>
                ids.includes('seg-1') ? new Map([['seg-1', segment as never]]) : new Map(),
            );

            return harness;
        };

        it('airs a break whose words are still true of the time', async () => {
            const { director, rundown } = await timed({ from: Date.now() - 60_000, until: Date.now() + 300_000 });

            await director.start();
            await settle();

            expect(rundown.upcoming().some(item => item.externalId === 'seg-1')).toBe(true);
        });

        it('drops a break whose time has passed', async () => {
            // The order ran slow, or an operator shuffled it: the slot arrives after "just after
            // nine" stopped being true. Saying it anyway is the error a listener remembers.
            const { director, rundown } = await timed({ from: Date.now() - 900_000, until: Date.now() - 60_000 });

            await director.start();
            await settle();

            expect(rundown.upcoming().every(item => item.externalId !== 'seg-1')).toBe(true);
            // And the order keeps its lead, through the same branch every other skip takes.
            expect(rundown.upcoming().map(item => item.externalId)).toEqual(['a']);
        });

        it('drops a break that arrives before its words are true', async () => {
            // The other end, and the one the projection is built to avoid: reaching the slot EARLY
            // means saying "just after nine" before nine.
            const { director, rundown } = await timed({ from: Date.now() + 300_000, until: Date.now() + 600_000 });

            await director.start();
            await settle();

            expect(rundown.upcoming().every(item => item.externalId !== 'seg-1')).toBe(true);
        });
    });

    // Play history steers what plays NEXT: the repeat window and the artist cooldown are both
    // reads of it. A row for an ident would have the station suppressing its own idents.
    it('keeps a segment out of play history when it airs', async () => {
        const { director, lineup, rundown, history, seed } = build({ items: ['a', 'b'], segments: [READY] });
        await seed();
        lineup.insertSegment('seg-1', 0);
        await director.start();
        await settle();

        const segmentItem = rundown.upcoming().find(item => item.pluginId === RENDER_PLUGIN_ID)!;
        await rundown.next();
        rundown.markAired(segmentItem.id);
        await settle();

        expect(history.record).not.toHaveBeenCalled();
    });

    it('still records a record that airs', async () => {
        const { director, rundown, history, seed } = build({ items: ['a', 'b'] });
        await seed();
        await director.start();
        await settle();

        const first = rundown.upcoming()[0]!;
        await rundown.next();
        rundown.markAired(first.id);
        await settle();

        expect(history.record).toHaveBeenCalledOnce();
    });
});

// The refill job plants breaks among the records it appends, which covers a rotation. This pass is
// what covers a lineup nothing ever refills — an imported provider playlist above all, which would
// otherwise play for an hour without once saying what station it is.
describe('DirectorService planting breaks', () => {
    it('plants into a lineup nothing will ever extend', async () => {
        const { director, lineup, seed } = build({ items: Array.from({ length: 20 }, (_, index) => `t${index}`) });
        await seed();

        await director.start();
        await settle();

        expect(lineup.all().some(item => item.kind === 'segment')).toBe(true);
    });

    it('plants before it commits, so a break is never left behind the records just handed over', async () => {
        const { director, lineup, seed } = build({ items: Array.from({ length: 20 }, (_, index) => `t${index}`) });
        await seed();

        await director.start();
        await settle();

        // Everything planted is still ahead of the cursor: nothing was dropped into the part of the
        // order the player is already holding.
        const planted = lineup.all().flatMap((item, index) => (item.kind === 'segment' ? [index] : []));
        expect(planted.every(index => index >= lineup.committedThrough())).toBe(true);
    });

    it('plants at the spacing the operator set, not at the built-in default', async () => {
        // The whole point of the rules becoming settings: this is the first one an operator can
        // change and hear the difference, with no redeploy and no restart.
        const { director, lineup, station, seed } = build({ items: Array.from({ length: 20 }, (_, index) => `t${index}`) });
        station.set(ROTATION_KEYS.breakEveryMinutes, String(2 * TRACK_MINUTES));
        await seed();

        await director.start();
        await settle();

        const spacing = lineup
            .all()
            .flatMap((item, index) => (item.kind === 'segment' ? [index] : []))
            .slice(0, 2);
        // Ten minutes between breaks — two records here — rather than the default quarter of an
        // hour, so the first two planted slots are three apart rather than four.
        expect(spacing[1]! - spacing[0]!).toBe(3);
    });

    it('plants nothing when the operator has turned breaks off', async () => {
        const { director, lineup, station, seed } = build({ items: Array.from({ length: 20 }, (_, index) => `t${index}`) });
        station.set(ROTATION_KEYS.breaks, 'false');
        await seed();

        await director.start();
        await settle();

        expect(lineup.all().some(item => item.kind === 'segment')).toBe(false);
    });

    // A break is the one thing in a commit pass the broadcast does not depend on: the records
    // either side of it play regardless.
    it('keeps the running order full when the planner throws', async () => {
        const { director, rundown, breaks, seed } = build();
        breaks.plant = vi.fn(async () => {
            throw new Error('the library is unreachable');
        });
        await seed();

        await director.start();
        await settle();

        expect(rundown.upcoming()).toHaveLength(COMMIT_LEAD);
    });
});

// The commit pass reads what is on air, plants breaks and looks segments up before it hands
// anything over, and the event loop is free at every one of those awaits. The operator's Stop lands
// there, synchronously, from a request handler on the same thread. A pass that trusted the checks
// it made at the top would resume on the far side of a decision that has already been reversed.
describe('DirectorService committing across a change underneath it', () => {
    it('commits nothing when the station is stood down mid-pass', async () => {
        const { director, rundown, lineup, segmentStub, seed } = build({
            items: ['a', 'b', 'c'],
            segments: [{ id: 'seg-1', kind: 'ident', state: 'ready', label: 'Ident', source: 'library' }],
        });
        await seed();
        // A segment at the head, so the pass must await a lookup before it can commit anything.
        lineup.insertSegment('seg-1', 0);

        let began: (() => void) | undefined;
        const started = new Promise<void>(resolve => (began = resolve));
        let unblock: (() => void) | undefined;
        const held = new Promise<void>(resolve => (unblock = resolve));
        segmentStub.findByIds = vi.fn(async () => {
            began?.();
            await held;
            return new Map<string, Segment>();
        });

        const starting = director.start();
        await started;

        // The Stop, landing exactly inside the lookup.
        rundown.reset();
        unblock!();
        await starting;
        await settle();

        expect(rundown.upcoming()).toHaveLength(0);
        expect(director.status().active).toBe(false);
    });

    // Putting a lineup on air is NOT a stand-down: the station stays on, so it goes through
    // `invalidate` rather than `reset`, and that is the path a pass in flight used to survive.
    // The operator switches programming, the suspended pass resumes past its own guard, and the
    // records of the lineup they just took off are appended to the running order that was
    // retracted for them — a quarter of an hour of the old programme after the switch.
    it('commits nothing from the old programme when a new one goes on air mid-pass', async () => {
        // Bug 1, and the reason `invalidate` is synchronous. A pass suspended in a segment lookup
        // has already decided what to commit; a command queued behind it arrives too late to stop
        // it, and the records it appends land inside the programme that has just replaced them.
        const { director, rundown, lineup, segmentStub, seed, snapshots } = build({
            items: ['a', 'b', 'c'],
            segments: [{ id: 'seg-1', kind: 'ident', state: 'ready', label: 'Ident', source: 'library' }],
        });
        await seed();
        // A segment at the head, so the pass must await a lookup before it can commit anything.
        lineup.insertSegment('seg-1', 0);

        let began: (() => void) | undefined;
        const started = new Promise<void>(resolve => (began = resolve));
        let unblock: (() => void) | undefined;
        const held = new Promise<void>(resolve => (unblock = resolve));
        segmentStub.findByIds = vi.fn(async () => {
            began?.();
            await held;
            return new Map<string, Segment>();
        });

        const starting = director.start();
        await started;

        // The switch, landing exactly inside the lookup: what `DirectorConsoleService.putOnAir`
        // does, in the order it does it. The cancel is synchronous and reaches the pass already
        // gathering; the command queues behind it.
        director.invalidate();
        const switched = director.post({
            kind: 'putOnAir',
            binding: { name: 'Something else', mode: 'rotation', onEnd: 'extend', source: 'import' },
            tracks: [track('x'), track('y')],
        });

        unblock!();
        await starting;
        await switched;
        await settle();

        // Only the new programme. Without the synchronous cancel the blocked pass resumes past
        // its own guard and appends the OLD records behind these, which is a quarter of an hour
        // of a show the operator has just taken off air.
        expect(idsOf(rundown.upcoming())).toEqual(['x']);
        expect(snapshots.at(-1)?.items.map(item => item.kind === 'track' && item.track.externalId)).toEqual(['x', 'y']);
    });

    it('marks nothing when the work before the hand-over fails', async () => {
        const { director, lineup, segmentStub, seed } = build({ items: ['a', 'b', 'c'] });
        await seed();
        lineup.insertSegment('seg-1', 0);
        segmentStub.findByIds = vi.fn(async () => {
            throw new Error('the database is gone');
        });

        await director.start().catch(() => undefined);
        await settle();

        // Marking first and gathering afterwards is how a failure in the middle loses programming
        // for good: the items would read as spent and nothing would ever offer them again.
        expect(lineup.committedThrough()).toBe(0);
        expect(lineup.remaining()).toBe(4);
    });
});

// A talk-over is heard ALONGSIDE a record rather than in the gap before it, so it never becomes a
// line of the running order. It rides on the record that follows and the pusher arms it as that
// record is handed over.
describe('DirectorService committing a talk-over', () => {
    const READY = { id: 'seg-1', kind: 'talkbreak', state: 'ready' as const, label: 'Over the intro', source: 'library' };

    it('attaches it to the record that follows rather than committing it as an item', async () => {
        const { director, lineup, rundown, seed } = build({ items: ['a', 'b', 'c'], segments: [READY] });
        await seed();
        lineup.insertSegment('seg-1', 0, { atMs: 8000 });

        await director.start();
        await settle();

        const committed = rundown.upcoming();
        // The record only, with no extra item for the segment: it is heard OVER 'a' rather than
        // between anything.
        expect(committed.map(item => item.externalId)).toEqual(['a']);
        expect(committed[0]?.voice).toEqual({ segmentId: 'seg-1', atMs: 8000 });
    });

    // A batch is one item now, so a talk-over planted at the END of a batch has nothing in that
    // batch to ride on and has to survive to the next one. Dropping it would silently lose them.
    it('holds one whose record is in the next batch', async () => {
        const { director, lineup, rundown, seed } = build({ items: ['a', 'b'], segments: [READY] });
        await seed();
        // After 'a', so it belongs to 'b' and there is nothing in this batch for it to ride on.
        lineup.insertSegment('seg-1', 1, { atMs: 5000 });

        await director.start();
        await settle();
        expect(rundown.upcoming().some(item => item.voice !== undefined)).toBe(false);

        // The player takes one, which is what makes room for the next commit.
        await airNext(rundown);

        expect(rundown.upcoming().find(item => item.externalId === 'b')?.voice).toEqual({ segmentId: 'seg-1', atMs: 5000 });
    });

    // Two voices at once is the one outcome nobody wants; queueing them would produce exactly that.
    it('keeps the later of two talk-overs in a row', async () => {
        const { director, lineup, rundown, seed } = build({
            items: ['a', 'b'],
            segments: [READY, { id: 'seg-2', kind: 'talkbreak', state: 'ready', label: 'Also over the intro', source: 'library' }],
        });
        await seed();
        // Both in front of the SAME record, which is what makes them a pair rather than one each.
        lineup.insertSegment('seg-1', 0, { atMs: 1000 });
        lineup.insertSegment('seg-2', 1, { atMs: 2000 });

        await director.start();
        await settle();

        expect(rundown.upcoming().find(item => item.externalId === 'a')?.voice).toEqual({ segmentId: 'seg-2', atMs: 2000 });
    });

    // A cue is about a particular record in a particular running order. One held across a
    // stand-down would attach itself to the first record of whatever came next.
    it('forgets a held talk-over when the station stands down', async () => {
        const { director, lineup, rundown, seed } = build({ items: ['a', 'b', 'c', 'd'], segments: [READY] });
        await seed();
        lineup.insertSegment('seg-1', 3, { atMs: 5000 });
        await director.start();
        await settle();

        rundown.reset();
        await settle();
        // Back on air with the same order: the held cue must not attach itself to the first
        // record of what comes next.
        await director.post({
            kind: 'putOnAir',
            binding: { name: 'Afternoons', mode: 'rotation', onEnd: 'extend', source: 'import' },
            tracks: [track('x'), track('y')],
        });
        await settle();

        expect(rundown.upcoming().every(item => item.voice === undefined)).toBe(true);
    });

    // Without `over` it is an ordinary segment and airs in the gap, which is phase 2's path and
    // stays the default.
    it('leaves a plain segment as an item of its own', async () => {
        const { director, lineup, rundown, seed } = build({ items: ['a', 'b'], segments: [READY] });
        await seed();
        lineup.insertSegment('seg-1', 1);

        await director.start();
        await settle();

        expect(rundown.upcoming()[1]).toMatchObject({ externalId: 'seg-1' });
        expect(rundown.upcoming().every(item => item.voice === undefined)).toBe(true);
    });
});

// An edit used to be a write to a row that the reactor then re-read on a timer, with all the
// racing that implies: a flag, a one-second poll, and a window in which the reactor committed from
// a plan it had already been told was wrong. The running order is the reactor's own state now, so
// an edit is a command applied to it and there is nothing to re-read at all.
describe('DirectorService editing what is on air', () => {
    it('applies an edit and answers with whether it took', async () => {
        const { director, lineup, seed } = build();
        await seed();
        await director.start();

        const before = lineup.size();
        const last = lineup.all()[before - 1]!;
        expect(await director.applyEdit({ kind: 'remove', itemId: last.id })).toEqual({ ok: true });
        expect(lineup.size()).toBe(before - 1);
    });

    it('refuses an edit to what the player is already holding', async () => {
        const { director, lineup, rundown, seed } = build();
        await seed();
        await director.start();
        await rundown.next();

        const committed = lineup.all()[0]!;
        expect(await director.applyEdit({ kind: 'remove', itemId: committed.id })).toMatchObject({ ok: false, reason: 'already-aired' });
    });

    it('answers rather than throwing when nothing is on air', async () => {
        const { director } = build({ noOrder: true });
        await director.start();

        expect(await director.applyEdit({ kind: 'shuffle' })).toMatchObject({ ok: false, reason: 'not-found' });
    });

    it('writes the edit down before the caller is told it happened', async () => {
        // The one write that cannot ride the throttle: the response says it happened, so it has
        // to have happened. A transport transition is the other side of that trade — nobody is
        // waiting on those, and the correct failure for them is to replay.
        const { director, lineups, lineup, seed } = build();
        await seed();
        await director.start();
        vi.mocked(lineups.save).mockClear();

        await director.applyEdit({ kind: 'remove', itemId: lineup.all()[lineup.size() - 1]!.id });

        expect(lineups.save).toHaveBeenCalled();
    });

    it('retires the segment row behind a break the operator removes', async () => {
        // The quiet half of the removed-break bug. The row used to be left in `planned`, with a
        // write job possibly in flight for it, and nothing ever collected it: it sat in the
        // library looking like a break that was still coming.
        const { director, lineup, segmentStub, seed } = build({
            segments: [{ id: 'talk-1', kind: 'talk', state: 'planned', label: 'Talk break', source: 'render' }],
        });
        await seed();
        await director.start();
        lineup.insertSegment('talk-1', lineup.size());

        await director.applyEdit({ kind: 'remove', itemId: lineup.all()[lineup.size() - 1]!.id });

        expect(segmentStub.markFailed).toHaveBeenCalledWith('talk-1', expect.stringContaining('removed'), 'planned');
    });

    it('leaves an ident alone, because the same recording is at three slots in an hour', async () => {
        const { director, lineup, segmentStub, seed } = build({
            segments: [{ id: 'ident-1', kind: 'ident', state: 'ready', label: 'Ident', source: 'library' }],
        });
        await seed();
        await director.start();
        lineup.insertSegment('ident-1', lineup.size());

        await director.applyEdit({ kind: 'remove', itemId: lineup.all()[lineup.size() - 1]!.id });

        expect(segmentStub.markFailed).not.toHaveBeenCalled();
    });

    it('tops the running order back up after a removal leaves room', async () => {
        const { director, rundown, lineup, seed } = build({ items: ['a', 'b', 'c', 'd'] });
        await seed();
        await director.start();
        expect(idsOf(rundown.upcoming())).toEqual(['a']);

        // Drop something further down the order; the pass behind the edit leaves the window full.
        await director.applyEdit({ kind: 'remove', itemId: lineup.all()[3]!.id });

        expect(idsOf(rundown.upcoming())).toEqual(['a']);
    });
});

// A replan arrives here already chosen and already resolved, because the job that generated it
// kept the old tail playing throughout. What is left for the director is the swap itself, and the
// rules about it are the ones every other edit obeys: the player's head is untouchable, and a break
// that has left the order owns a row somebody has to write off.
describe('DirectorService replacing the rest of the running order', () => {
    it('swaps the planned tail for the records it was handed', async () => {
        const { director, lineup, rundown, seed } = build({ items: ['a', 'b', 'c'] });
        await seed();
        await director.start();
        await rundown.next();

        await director.post({ kind: 'replaceTail', tracks: [track('x'), track('y')] });

        expect(
            lineup
                .all()
                .filter(isTrackItem)
                .map(item => item.track.externalId),
        ).toEqual(['a', 'x', 'y']);
    });

    it('leaves what the player is holding exactly where it is', async () => {
        // The same line a shuffle draws, and for the same reason: those items are already with the
        // player, and an operator asking for different programming is not asking to cut a listener off.
        const { director, lineup, rundown, seed } = build({ items: ['a', 'b', 'c'] });
        await seed();
        await director.start();
        await rundown.next();

        await director.post({ kind: 'replaceTail', tracks: [track('x')] });

        expect(lineup.all()[0]?.state).not.toBe('planned');
        expect(
            lineup
                .all()
                .filter(isTrackItem)
                .map(item => item.track.externalId)[0],
        ).toBe('a');
    });

    it('does nothing at all with an empty replacement', async () => {
        // Guarded twice, here and in the job. Emptying the running order is exactly how the station
        // loses its mount lease, and this is the last place that can refuse to.
        const { director, lineup, seed } = build({ items: ['a', 'b', 'c'] });
        await seed();
        await director.start();

        await director.post({ kind: 'replaceTail', tracks: [] });

        expect(lineup.size()).toBe(3);
    });

    it('writes the swap down before anything else happens to it', async () => {
        const { director, lineups, seed } = build({ items: ['a', 'b'] });
        await seed();
        await director.start();
        vi.mocked(lineups.save).mockClear();

        await director.post({ kind: 'replaceTail', tracks: [track('x')] });

        expect(lineups.save).toHaveBeenCalled();
    });

    it('asks for the new records to be described, since every one of them is new', async () => {
        const { director, jobs, seed } = build({ items: ['a', 'b'] });
        await seed();
        await director.start();
        jobs.send.mockClear();

        await director.post({ kind: 'replaceTail', tracks: [track('x'), track('y')] });

        expect(jobs.send.mock.calls.filter(call => call[0] === 'catalog.enrich')).toHaveLength(1);
    });

    it('retires a break that was still being written for the tail it just threw away', async () => {
        // That break describes a moment that will never come round now. Left alone it finishes and
        // sits in the library looking like a break that is still coming.
        const { director, lineup, segmentStub, seed } = build({
            items: ['a', 'b'],
            segments: [{ id: 'talk-1', kind: 'talk', state: 'planned', label: 'Talk break', source: 'render' }],
        });
        await seed();
        await director.start();
        lineup.insertSegment('talk-1', lineup.size());

        await director.post({ kind: 'replaceTail', tracks: [track('x')] });

        expect(segmentStub.markFailed).toHaveBeenCalledWith('talk-1', expect.stringContaining('replanned'), 'planned');
    });

    it('leaves a ready ident alone, because it is material an operator can put back', async () => {
        const { director, lineup, segmentStub, seed } = build({
            items: ['a', 'b'],
            segments: [{ id: 'ident-1', kind: 'ident', state: 'ready', label: 'Ident', source: 'library' }],
        });
        await seed();
        await director.start();
        lineup.insertSegment('ident-1', lineup.size());

        await director.post({ kind: 'replaceTail', tracks: [track('x')] });

        expect(segmentStub.markFailed).not.toHaveBeenCalled();
    });

    it('writes a new brief straight through, because the job that reads it reads the row', async () => {
        // The throttle is two seconds and the replan job is sent immediately behind this. Riding it
        // would programme the fresh hour against the brief the operator has just replaced.
        const { director, lineups, seed, snapshots } = build({ items: ['a', 'b'] });
        await seed();
        await director.start();
        vi.mocked(lineups.save).mockClear();

        await director.post({ kind: 'rebrief', brief: 'heavy metal hits' });

        expect(lineups.save).toHaveBeenCalled();
        expect(snapshots.at(-1)?.brief).toBe('heavy metal hits');
    });

    it('leaves the running order itself alone when only the brief changed', async () => {
        // A brief says what to play NEXT. Nothing about the records already chosen is wrong because
        // the operator changed their mind about the ones after them.
        const { director, lineup, seed } = build({ items: ['a', 'b', 'c'] });
        await seed();
        await director.start();

        await director.post({ kind: 'rebrief', brief: 'heavy metal hits' });

        expect(
            lineup
                .all()
                .filter(isTrackItem)
                .map(item => item.track.externalId),
        ).toEqual(['a', 'b', 'c']);
    });

    it('commits off the new tail, so the swap reaches the player without waiting for a boundary', async () => {
        const { director, rundown, seed } = build({ items: ['a', 'b', 'c'] });
        await seed();
        await director.start();
        await airNext(rundown);

        await director.post({ kind: 'replaceTail', tracks: [track('x'), track('y')] });
        await settle();

        expect(idsOf(rundown.upcoming())).toContain('x');
    });
});

describe('DirectorService asking for a refill', () => {
    it('sends the refill from a scope of its own', async () => {
        const { director, jobs, seed } = build({ items: ['a', 'b', 'c'] });
        await seed();

        await director.start();
        await settle();

        expect(jobs.send).toHaveBeenCalledWith('director.extend_lineup', {});
    });

    // The one that turned a transient failure into a permanent one.
    it('asks again after a send that failed', async () => {
        const { director, rundown, jobs, seed } = build({ items: ['a', 'b', 'c'] });
        await seed();
        jobs.send.mockRejectedValueOnce(new Error('the broker is not available here'));

        await director.start();
        await settle();
        await wake(rundown);

        // Before the fix the guard was set before the send, so the one that threw latched it and
        // the station never asked again. Now the guard is only set once a send has landed, so a
        // failure is retried on the next pass.
        expect(jobs.send.mock.calls.length).toBeGreaterThan(1);
    });

    it('does not ask twice for the same shortfall once a send has landed', async () => {
        const { director, rundown, jobs, seed } = build({ items: ['a', 'b', 'c'] });
        await seed();
        await director.start();
        await settle();

        await wake(rundown);
        await wake(rundown);

        expect(jobs.send).toHaveBeenCalledTimes(1);
    });
});

// Memory is the authority and the row is the record. The split is by whether anything is waiting
// for an answer: an operator's edit is written through before they are told it happened, and the
// transport's own transitions ride a throttle, because nobody is waiting on those and the correct
// failure for them is to replay.
describe('DirectorService writing the running order down', () => {
    it('does not write on every transition', async () => {
        const { director, rundown, lineups, seed } = build();
        await seed();
        await director.start();
        vi.mocked(lineups.save).mockClear();

        for (let index = 0; index < 3; index++) {
            const pulled = await rundown.next();
            rundown.markAired(pulled!.item.id);
            await settle();
        }

        expect(lineups.save).not.toHaveBeenCalled();
    });

    it('writes within the throttle, however busy the station is', async () => {
        // A throttle rather than a debounce. A debounce reset by each new transition starves
        // exactly when a stale record is least affordable — a station that never stops moving.
        vi.useFakeTimers();
        try {
            const { director, rundown, lineups, seed } = build();
            await seed();
            await director.start();
            vi.mocked(lineups.save).mockClear();

            await rundown.next();
            await vi.advanceTimersByTimeAsync(500);
            await rundown.next();
            await vi.advanceTimersByTimeAsync(500);
            expect(lineups.save).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(2_000);
            expect(lineups.save).toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('flushes what it owes on a graceful stop', async () => {
        // The difference between a clean shutdown and a kill: a stop that dropped the pending
        // write would cost the station its last couple of seconds and replay a record for them.
        const { director, rundown, lineups, seed } = build();
        await seed();
        await director.start();
        vi.mocked(lineups.save).mockClear();
        await rundown.next();

        await director.stop();

        expect(lineups.save).toHaveBeenCalled();
    });

    it('writes an acknowledged edit through rather than throttling it', async () => {
        // The response says it happened, so it has to have happened.
        const { director, lineup, lineups, seed } = build();
        await seed();
        await director.start();
        vi.mocked(lineups.save).mockClear();

        await director.applyEdit({ kind: 'remove', itemId: lineup.all()[lineup.size() - 1]!.id });

        expect(lineups.save).toHaveBeenCalled();
    });
});

describe('DirectorService opening a database scope', () => {
    // The repositories are scoped and this class is a singleton, so every read
    // below opens a scope of its own and closes it again. It opens them from the
    // container it was injected with, which is the ROOT: InjectKit resolves a
    // singleton's dependencies from the root rather than from whichever scope
    // built it, and two of this class's dependents are resolved per scope
    // (`ExtendLineupJob` from the job runner's, `DirectorConsoleService` from a
    // request's). Before that rule, a race decided whether these scopes were the
    // children of a container that had already been disposed, and it logged
    // `Transaction is already committed` on roughly a third of boots.
    it('opens a scope per unit of work and disposes it', async () => {
        const { director, createScope, scope, seed } = build({ items: ['a'] });
        await seed();

        await director.start();
        // `start` ends in a restore whose commit pass leaves work in flight; a scope
        // still open here is one the assertion below would blame for leaking.
        await settle();

        expect(createScope).toHaveBeenCalled();
        expect(scope.disposeAsync).toHaveBeenCalledTimes(createScope.mock.calls.length);
    });

    // What a producer outside the running order gets. The placement itself is BreakPlanner's and is
    // tested there; what is here is the director's own restraint.
    describe('requestBreak', () => {
        const asking = { kind: 'talkbreak', urgency: 'next', source: 'audience', reason: 'somebody tuned in' } as const;

        it('takes a request, writes it down and asks for the words', async () => {
            const { director, seed, requests, jobs } = build({ canTalk: true });
            await seed();
            await director.start();

            const result = await director.requestBreak({ ...asking });

            expect(result.accepted).toBe(true);
            expect(requests.open).toHaveBeenCalled();
            expect(requests.attachSegment).toHaveBeenCalledWith('req-1', result.segmentId);
            expect(jobs.send).toHaveBeenCalledWith('director.write_break', { segmentId: result.segmentId });
        });

        it('says no while the station is not airing anything', async () => {
            // Not a fault: a producer watching an edge has no idea whether the station is on, and
            // planting into an order that does not exist is not something to half-do.
            const { director } = build({ air: { active: false }, canTalk: true });

            const result = await director.requestBreak({ ...asking });

            expect(result.accepted).toBe(false);
            expect(result.reason).toContain('not airing');
        });

        it('holds a keyed request off for its cooldown', async () => {
            // The case this exists for: a phone changing networks, or the console's own player being
            // toggled, is a second arrival within seconds and must not be a second greeting.
            const { director, seed, jobs } = build({ canTalk: true });
            await seed();
            await director.start();

            const first = await director.requestBreak({ ...asking, key: 'welcome', cooldownMs: 20 * 60_000 });
            const second = await director.requestBreak({ ...asking, key: 'welcome', cooldownMs: 20 * 60_000 });

            expect(first.accepted).toBe(true);
            expect(second.accepted).toBe(false);
            expect(second.reason).toContain('already took');
            expect(jobs.send.mock.calls.filter(([name]) => name === 'director.write_break')).toHaveLength(1);
        });

        it('writes nothing down for a break this station could never produce', async () => {
            // Judged before the row exists, so the table does not fill with requests for a kind
            // nothing here can write or speak.
            const { director, seed, requests } = build({ canTalk: false });
            await seed();
            await director.start();

            const result = await director.requestBreak({ ...asking });

            expect(result.accepted).toBe(false);
            expect(requests.open).not.toHaveBeenCalled();
        });

        it('gives an urgent request no position at all until its audio exists', async () => {
            // The inversion. A planted break arriving at its slot unready is skipped, which is right
            // for a routine one and fatal for a break that exists because something happened.
            const { director, seed, requests, jobs, lineup } = build({ canTalk: true });
            await seed();
            await director.start();
            const segmentsBefore = lineup.all().filter(item => item.kind === 'segment').length;

            const result = await director.requestBreak({ ...asking, urgency: 'next' });

            expect(result.accepted).toBe(true);
            expect(result.atIndex).toBeUndefined();
            expect(lineup.all().filter(item => item.kind === 'segment')).toHaveLength(segmentsBefore);
            // Written down as pending, with a deadline: a break held back for its audio is one that
            // could be held back forever.
            expect(requests.open).toHaveBeenCalledWith(expect.objectContaining({ urgency: 'next' }), 'pending', expect.any(Number));
            expect(jobs.send).toHaveBeenCalledWith('director.write_break', { segmentId: result.segmentId });
        });

        const inFlight = (overrides: Partial<StoredBreakRequest> = {}): StoredBreakRequest => ({
            id: 'req-1',
            kind: 'talkbreak',
            urgency: 'next',
            source: 'audience',
            state: 'pending',
            segmentId: 'seg-ready',
            ...overrides,
        });

        it('places a waiting break as soon as its audio exists', async () => {
            const { director, seed, requests, lineup } = build({
                canTalk: true,
                waiting: [inFlight()],
                segments: [{ id: 'seg-ready', kind: 'talkbreak', state: 'ready', label: 'Talk break' }],
            });
            await seed();

            await director.start();

            // At the front of what had not been committed: the words are spoken and the file is on
            // disk, so the only thing left to decide is a position.
            const at = lineup.all().findIndex(item => item.kind === 'segment' && item.segmentId === 'seg-ready');
            expect(at).toBeGreaterThanOrEqual(0);
            expect(at).toBeLessThanOrEqual(lineup.committedThrough());
            expect(requests.moveTo).toHaveBeenCalledWith('req-1', 'placed', 'ready');
        });

        it('leaves a break that is still being made where it is', async () => {
            const { director, seed, requests, lineup } = build({
                canTalk: true,
                waiting: [inFlight()],
                segments: [{ id: 'seg-ready', kind: 'talkbreak', state: 'rendering', label: 'Talk break' }],
            });
            await seed();

            await director.start();

            expect(lineup.all().some(item => item.kind === 'segment' && item.segmentId === 'seg-ready')).toBe(false);
            expect(requests.moveTo).not.toHaveBeenCalledWith('req-1', 'placed', 'ready');
        });

        it('retires a break whose moment passed before it was ready', async () => {
            // The half that keeps the whole arrangement honest: a break held back until its audio
            // exists is one that can be held back forever, and a bulletin twenty minutes late is not
            // news.
            const { director, seed, requests, segmentStub, activity } = build({
                canTalk: true,
                waiting: [inFlight({ expiresAt: Date.now() - 1000 })],
                segments: [{ id: 'seg-ready', kind: 'talkbreak', state: 'ready', label: 'Talk break' }],
            });
            await seed();

            await director.start();

            expect(requests.moveTo).toHaveBeenCalledWith('req-1', 'expired', ['pending', 'ready']);
            expect(segmentStub.markFailed).toHaveBeenCalledWith('seg-ready', expect.stringContaining('was not ready'), 'ready');
            expect(activity.record).toHaveBeenCalledWith(expect.objectContaining({ kind: 'break.expired' }));
        });

        it('asks again for the words of a break nothing has claimed', async () => {
            // The one break `ripen` cannot cover: it re-offers what the running order holds, and a
            // break waiting for its audio is deliberately outside it. Without this a write job lost
            // to a restart strands the request silently until it expires.
            const { director, seed, jobs } = build({
                canTalk: true,
                waiting: [inFlight()],
                segments: [{ id: 'seg-ready', kind: 'talkbreak', state: 'planned', label: 'Talk break' }],
            });
            await seed();

            await director.start();

            expect(jobs.send).toHaveBeenCalledWith('director.write_break', { segmentId: 'seg-ready' });
        });

        it('leaves a break somebody is already writing alone', async () => {
            const { director, seed, jobs } = build({
                canTalk: true,
                waiting: [inFlight()],
                segments: [{ id: 'seg-ready', kind: 'talkbreak', state: 'writing', label: 'Talk break' }],
            });
            await seed();

            await director.start();

            expect(jobs.send).not.toHaveBeenCalledWith('director.write_break', { segmentId: 'seg-ready' });
        });

        it('gives up on a request whose break nothing could write', async () => {
            const { director, seed, requests } = build({
                canTalk: true,
                waiting: [inFlight()],
                segments: [{ id: 'seg-ready', kind: 'talkbreak', state: 'failed', label: 'Talk break' }],
            });
            await seed();

            await director.start();

            expect(requests.moveTo).toHaveBeenCalledWith('req-1', 'failed', ['pending', 'ready']);
        });
    });
});
