// Warming the next few records. Everything here is about restraint rather than coverage: a fetch is a
// whole record off a rate-limited credential, and the station plays fine without any of this, so the
// interesting assertions are all about what it declines to ask for.

import { Logger } from '@maroonedsoftware/logger';
import type { PgBossJobBroker } from '@maroonedsoftware/jobbroker/pgboss';
import { DateTime } from 'luxon';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SourceAudio, TrackAudioRepository } from '../../../../src/modules/playout/audio/track.audio.repository.js';
import { CACHE_AHEAD, type TrackAudioService } from '../../../../src/modules/playout/audio/track.audio.service.js';
import { TrackCachePlanner } from '../../../../src/modules/playout/audio/track.cache.planner.js';
import type { StationLineup, StationLineupItem } from '../../../../src/modules/director/station.lineup.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

// The logger is shared across cases, so the "says nothing" assertion needs a clean slate.
beforeEach(() => vi.clearAllMocks());

/**
 * A record in the running order. `n` is both its position and its identity.
 *
 * It carries a `trackId`, because the catalog holding the record is what makes it this pass's
 * business at all: an item without one is skipped outright. See {@link uncataloguedItem}.
 */
const trackItem = (n: number, state: 'planned' | 'played' = 'planned'): StationLineupItem =>
    ({
        id: `item-${n}`,
        kind: 'track',
        state,
        track: {
            pluginId: 'deadair.spotify',
            externalId: `spotify-${n}`,
            trackId: `track-${n}`,
            title: `Track ${n}`,
            artists: ['An Artist'],
        },
    }) as StationLineupItem;

/**
 * A record straight off a provider playlist, which the catalog has never seen.
 *
 * No `trackId`, which is the ordinary state of every item on a fresh station and of an imported
 * playlist ahead of the first sync. There is no `track_sources` row behind it, so there is nothing
 * to fetch and nothing that could be benched.
 */
const uncataloguedItem = (n: number, durationMs?: number): StationLineupItem =>
    ({
        id: `item-${n}`,
        kind: 'track',
        state: 'planned',
        track: {
            pluginId: 'deadair.spotify',
            externalId: `spotify-${n}`,
            title: `Track ${n}`,
            artists: ['An Artist'],
            ...(durationMs === undefined ? {} : { durationMs }),
        },
    }) as StationLineupItem;

const segmentItem = (n: number): StationLineupItem =>
    ({ id: `item-${n}`, kind: 'segment', state: 'planned', segmentId: `seg-${n}` }) as StationLineupItem;

const lineupOf = (items: StationLineupItem[], committedThrough = 0): StationLineup =>
    ({ all: () => items, committedThrough: () => committedThrough }) as unknown as StationLineup;

/** State for `spotify-<n>`, uncached and never tried unless a case says otherwise. */
const state = (n: number, overrides: Partial<SourceAudio> = {}): SourceAudio => ({
    sourceId: `source-${n}`,
    pluginId: 'deadair.spotify',
    externalId: `spotify-${n}`,
    attempts: 0,
    ...overrides,
});

const build = (states: SourceAudio[], options: { fetching?: string[]; error?: Error } = {}) => {
    const findForBindings = vi.fn(async () => {
        if (options.error) throw options.error;
        return states;
    });
    const send = vi.fn(async () => 'job-1');
    const isFetching = vi.fn((sourceId: string) => (options.fetching ?? []).includes(sourceId));
    // What the eviction sweep is told it may not touch. Published here rather than looked up there,
    // because a job reaching for the running order would be `playout` depending on `director`.
    const protect = vi.fn((sourceIds: readonly string[]) => sourceIds);

    const planner = new TrackCachePlanner(
        { findForBindings } as unknown as TrackAudioRepository,
        { isFetching, protect } as unknown as TrackAudioService,
        { send } as unknown as PgBossJobBroker,
        logger,
    );

    return { planner, findForBindings, send, protect };
};

describe('TrackCachePlanner.ripen', () => {
    it('asks for the nearest records that are not here yet, nearest first', async () => {
        const { planner, send } = build([state(1), state(2), state(3)]);

        expect(await planner.ripen(lineupOf([trackItem(1), trackItem(2), trackItem(3)]))).toMatchObject({ asked: 2 });
        expect(send).toHaveBeenNthCalledWith(1, 'playout.cache_track', { sourceId: 'source-1' });
        expect(send).toHaveBeenNthCalledWith(2, 'playout.cache_track', { sourceId: 'source-2' });
    });

    // Two per pass, and the pass runs on every rundown change. That plus in-flight de-duplication is
    // what turns a window of six into a trickle instead of a burst on a rate-limited credential. It
    // is two rather than one because the window now LEADS the commit lead and the director declines
    // to commit a record whose audio is missing, so a cold order has to fill faster than it drains.
    it('asks for no more than two records per pass however many are missing', async () => {
        const { planner, send } = build([state(1), state(2), state(3)]);

        await planner.ripen(lineupOf([trackItem(1), trackItem(2), trackItem(3)]));

        expect(send).toHaveBeenCalledTimes(2);
    });

    it('fetches from the cursor rather than from the top of the order', async () => {
        const { planner, send } = build([state(3)]);

        // Two records already handed over, so the window opens at the third.
        await planner.ripen(lineupOf([trackItem(1, 'played'), trackItem(2, 'played'), trackItem(3)], 2));

        expect(send).toHaveBeenCalledExactlyOnceWith('playout.cache_track', { sourceId: 'source-3' });
    });

    // The READ is deliberately wider than the fetch window: everything the player is already holding
    // sits behind the cursor, including the record airing now, and the eviction sweep has to be told
    // about all of it. One query covers both, and only the forward half is a candidate to fetch.
    it('reads behind the cursor as well, so what is already playing can be protected', async () => {
        const { planner, findForBindings, protect } = build([state(1), state(2), state(3)]);

        await planner.ripen(lineupOf([trackItem(1, 'played'), trackItem(2, 'played'), trackItem(3)], 2));

        expect(findForBindings).toHaveBeenCalledWith([
            { pluginId: 'deadair.spotify', externalId: 'spotify-1' },
            { pluginId: 'deadair.spotify', externalId: 'spotify-2' },
            { pluginId: 'deadair.spotify', externalId: 'spotify-3' },
        ]);
        expect(protect).toHaveBeenCalledExactlyOnceWith(['source-1', 'source-2', 'source-3']);
    });

    // An order with no records ahead of it is a real state, and a set left over from whenever there
    // last was one would go on speaking for it.
    it('protects nothing at all when the window holds no records', async () => {
        const { planner, protect } = build([]);

        await planner.ripen(lineupOf([]));

        expect(protect).toHaveBeenCalledExactlyOnceWith([]);
    });

    it('looks no further ahead than the window', async () => {
        const items = Array.from({ length: 10 }, (_, index) => trackItem(index + 1));
        const { planner, findForBindings } = build([]);

        await planner.ripen(lineupOf(items));

        expect(findForBindings).toHaveBeenCalledWith(
            Array.from({ length: CACHE_AHEAD }, (_, index) => ({ pluginId: 'deadair.spotify', externalId: `spotify-${index + 1}` })),
        );
    });

    it('skips a record already on disk and takes the next one', async () => {
        const { planner, send } = build([state(1, { checksum: 'a'.repeat(64), ext: 'ogg' }), state(2)]);

        await planner.ripen(lineupOf([trackItem(1), trackItem(2)]));

        expect(send).toHaveBeenCalledExactlyOnceWith('playout.cache_track', { sourceId: 'source-2' });
    });

    // A request beat the ripener to it, or an earlier pass is still downloading. Either way the bytes
    // are already coming and a second job would wait on the same fetch for nothing.
    it('skips a record something is already fetching', async () => {
        const { planner, send } = build([state(1), state(2)], { fetching: ['source-1'] });

        await planner.ripen(lineupOf([trackItem(1), trackItem(2)]));

        expect(send).toHaveBeenCalledExactlyOnceWith('playout.cache_track', { sourceId: 'source-2' });
    });

    // The one place the backoff is honoured. A request for these bytes ignores it, because something is
    // waiting on them; a speculative fetch has no such excuse.
    it('leaves a backing-off record alone', async () => {
        const backingOff = state(1, { attempts: 2, nextAttemptAt: DateTime.now().plus({ minutes: 5 }), lastError: 'upstream answered 502' });
        const { planner, send } = build([backingOff, state(2)]);

        await planner.ripen(lineupOf([trackItem(1), trackItem(2)]));

        expect(send).toHaveBeenCalledExactlyOnceWith('playout.cache_track', { sourceId: 'source-2' });
    });

    it('asks again once the backoff has passed', async () => {
        const due = state(1, { attempts: 2, nextAttemptAt: DateTime.now().minus({ minutes: 1 }), lastError: 'upstream answered 502' });
        const { planner, send } = build([due]);

        await planner.ripen(lineupOf([trackItem(1)]));

        expect(send).toHaveBeenCalledExactlyOnceWith('playout.cache_track', { sourceId: 'source-1' });
    });

    // Absent from the answer means the catalog has written the copy off (`missing_at`, or not
    // playable). Nothing to fetch — and, since 2026-08-14, something to REPORT: the director takes
    // the line out of the running order while there is still an hour of order in front of it.
    it('reports a binding the catalog no longer offers as unfetchable', async () => {
        const { planner, send } = build([]);

        expect(await planner.ripen(lineupOf([trackItem(1)]))).toEqual({ asked: 0, unfetchable: ['item-1'], warming: 0 });
        expect(send).not.toHaveBeenCalled();
    });

    // A backoff the record's own slot arrives before is a WAIT. The ladder doubles to a day, so one
    // that outlasts the slot is a miss, and the two must not be confused: dropping a line over a
    // five-minute backoff would thin the rotation for a blip.
    it('leaves a record backing off within its own slot in the order', async () => {
        const { planner } = build([state(1, { nextAttemptAt: DateTime.now().plus({ seconds: 30 }) })]);

        const result = await planner.ripen(lineupOf([trackItem(1)]));

        expect(result.unfetchable).toEqual([]);
    });

    it('reports a record whose backoff outlasts its slot as unfetchable', async () => {
        const { planner } = build([state(1, { nextAttemptAt: DateTime.now().plus({ hours: 4 }) })]);

        expect((await planner.ripen(lineupOf([trackItem(1)]))).unfetchable).toEqual(['item-1']);
    });

    // The whole of a fresh station, and of an imported playlist ahead of the first sync. An item the
    // catalog has never seen is absent from `findForBindings` for exactly the same reason a benched
    // one is — the query joins from `track_sources` — and reading the two as one fact marked 125
    // records of a 519-item order permanently unavailable in eight minutes, none of them actually
    // unobtainable.
    it('leaves a record the catalog has never seen alone rather than calling it unfetchable', async () => {
        const { planner, send } = build([]);

        expect(await planner.ripen(lineupOf([uncataloguedItem(1), uncataloguedItem(2)]))).toEqual({ asked: 0, unfetchable: [], warming: 0 });
        expect(send).not.toHaveBeenCalled();
    });

    // The narrowing has to be a narrowing. A catalogued record whose every copy is benched is still
    // taken out of the order, which is the whole reason `unfetchable` exists.
    it('still reports a catalogued record beside an uncatalogued one', async () => {
        const { planner } = build([]);

        const result = await planner.ripen(lineupOf([uncataloguedItem(1), trackItem(2)]));

        expect(result.unfetchable).toEqual(['item-2']);
    });

    // An item this pass has no opinion about still occupies its slot. Skipping its duration would
    // shorten the projected airtime for everything behind it and judge their backoffs against a
    // moment that never arrives: the record below sits an hour back, so its half-hour backoff is a
    // comfortable wait — and would read as a miss against the bare four-minute committed lead.
    it('counts an uncatalogued record towards the slot of the records behind it', async () => {
        const { planner } = build([state(2, { nextAttemptAt: DateTime.now().plus({ minutes: 30 }) })]);

        const result = await planner.ripen(lineupOf([uncataloguedItem(1, 60 * 60_000), trackItem(2)]));

        expect(result.unfetchable).toEqual([]);
    });

    // What the silence diagnosis reads to tell a station warming up from one that is stuck. Both are
    // a full running order committing nothing; only this says whether anything is being done about
    // it.
    describe('saying how much is on its way', () => {
        it('counts the records it just asked for', async () => {
            const { planner } = build([state(1), state(2), state(3)]);

            expect((await planner.ripen(lineupOf([trackItem(1), trackItem(2), trackItem(3)]))).warming).toBe(2);
        });

        it('counts a record an earlier pass is already fetching', async () => {
            const { planner, send } = build([state(1)], { fetching: ['source-1'] });

            expect((await planner.ripen(lineupOf([trackItem(1)]))).warming).toBe(1);
            // And does not ask again for it: the count is about what is happening, not what this
            // pass started.
            expect(send).not.toHaveBeenCalled();
        });

        it('counts a record on disk as nothing to wait for', async () => {
            const { planner } = build([state(1, { checksum: 'a'.repeat(64), ext: 'ogg' })]);

            expect((await planner.ripen(lineupOf([trackItem(1)]))).warming).toBe(0);
        });

        // The stuck half, and the reason the count exists at all: a window whose every copy is
        // benched has nothing coming, however full the running order looks.
        it('says nothing is on its way when every copy is written off', async () => {
            const { planner } = build([]);

            expect((await planner.ripen(lineupOf([trackItem(1), trackItem(2)]))).warming).toBe(0);
        });
    });

    it('reads nothing for a window holding no records', async () => {
        const { planner, findForBindings, send } = build([]);

        expect(await planner.ripen(lineupOf([segmentItem(1), segmentItem(2)]))).toEqual({ asked: 0, unfetchable: [], warming: 0 });
        expect(findForBindings).not.toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
    });

    it('says nothing when the whole window is already in hand', async () => {
        const { planner, send } = build([state(1, { checksum: 'a'.repeat(64), ext: 'ogg' })]);

        expect(await planner.ripen(lineupOf([trackItem(1)]))).toEqual({ asked: 0, unfetchable: [], warming: 0 });
        expect(send).not.toHaveBeenCalled();
        expect(logger.info).not.toHaveBeenCalled();
    });
});
