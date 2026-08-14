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

/** A record in the running order. `n` is both its position and its identity. */
const trackItem = (n: number, state: 'planned' | 'played' = 'planned'): StationLineupItem =>
    ({
        id: `item-${n}`,
        kind: 'track',
        state,
        track: { pluginId: 'deadair.spotify', externalId: `spotify-${n}`, title: `Track ${n}`, artists: ['An Artist'] },
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

    const planner = new TrackCachePlanner(
        { findForBindings } as unknown as TrackAudioRepository,
        { isFetching } as unknown as TrackAudioService,
        { send } as unknown as PgBossJobBroker,
        logger,
    );

    return { planner, findForBindings, send };
};

describe('TrackCachePlanner.ripen', () => {
    it('asks for the nearest records that are not here yet, nearest first', async () => {
        const { planner, send } = build([state(1), state(2), state(3)]);

        expect(await planner.ripen(lineupOf([trackItem(1), trackItem(2), trackItem(3)]))).toBe(2);
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

    it('starts at the cursor rather than at the top of the order', async () => {
        const { planner, findForBindings, send } = build([state(3)]);

        // Two records already handed over, so the window opens at the third.
        await planner.ripen(lineupOf([trackItem(1, 'played'), trackItem(2, 'played'), trackItem(3)], 2));

        expect(findForBindings).toHaveBeenCalledWith([{ pluginId: 'deadair.spotify', externalId: 'spotify-3' }]);
        expect(send).toHaveBeenCalledExactlyOnceWith('playout.cache_track', { sourceId: 'source-3' });
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
    // playable). Nothing to fetch, and the resolver declines it at hand-over anyway.
    it('does not ask for a binding the catalog no longer offers', async () => {
        const { planner, send } = build([]);

        expect(await planner.ripen(lineupOf([trackItem(1)]))).toBe(0);
        expect(send).not.toHaveBeenCalled();
    });

    it('reads nothing for a window holding no records', async () => {
        const { planner, findForBindings, send } = build([]);

        expect(await planner.ripen(lineupOf([segmentItem(1), segmentItem(2)]))).toBe(0);
        expect(findForBindings).not.toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
    });

    it('says nothing when the whole window is already in hand', async () => {
        const { planner, send } = build([state(1, { checksum: 'a'.repeat(64), ext: 'ogg' })]);

        expect(await planner.ripen(lineupOf([trackItem(1)]))).toBe(0);
        expect(send).not.toHaveBeenCalled();
        expect(logger.info).not.toHaveBeenCalled();
    });
});
