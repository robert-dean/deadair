// The audience is what the mount lease will be held on, so the interesting cases are
// all about what this class does with an ABSENT reading: a player reconnecting, an
// Icecast that went away, a count that never arrived. Reporting "no audience" too
// eagerly cuts a broadcast somebody is listening to; reporting one too readily airs a
// station to an empty room.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AudienceWatch } from '../../../src/modules/playout/audience.watch.js';
import { AIR_MODE_KEY } from '../../../src/modules/playout/air.mode.js';
import { settingsConfig } from '../../utils/settings.config.js';
import type { IcecastStatsClient } from '../../../src/modules/stream/icecast.stats.client.js';
import type { Logger } from '@maroonedsoftware/logger';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

/** The default station: `audience` mode, because nothing is stored. Never mutated. */
const { config } = settingsConfig();

/** A stats client whose answer the test moves, including to "did not answer". */
function stubStats(initial: number | undefined) {
    let answer = initial;
    const stats = {
        listeners: vi.fn(async () => answer),
        mountPath: () => '/live.mp3',
    };
    return {
        stats: stats as unknown as IcecastStatsClient,
        spy: stats,
        answer: (next: number | undefined) => {
            answer = next;
        },
    };
}

/** One poll cycle: advance to the interval and let the awaited read settle. */
async function tick(ms = 5_000): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
}

describe('AudienceWatch', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    it('reads zero, and no audience, before anything has answered', () => {
        const { stats } = stubStats(0);
        const watch = new AudienceWatch(stats, config, logger);

        expect(watch.listenerCount()).toBe(0);
        expect(watch.hasAudience()).toBe(false);
    });

    it('has an audience as soon as somebody is listening', async () => {
        const { stats, answer } = stubStats(0);
        const watch = new AudienceWatch(stats, config, logger);
        const edges: boolean[] = [];
        watch.onChange(present => edges.push(present));

        watch.start();
        await tick(0);
        expect(watch.hasAudience()).toBe(false);

        answer(1);
        await tick();

        expect(watch.listenerCount()).toBe(1);
        expect(watch.hasAudience()).toBe(true);
        expect(edges).toEqual([true]);
        watch.stop();
    });

    it('keeps the audience through the linger window after the last listener leaves', async () => {
        const { stats, answer } = stubStats(1);
        const watch = new AudienceWatch(stats, config, logger);
        const edges: boolean[] = [];
        watch.onChange(present => edges.push(present));

        watch.start();
        await tick(0);
        expect(watch.hasAudience()).toBe(true);

        // Gone, and back a few seconds later: exactly what a player reconnecting looks
        // like, and the one thing that must not cut the broadcast.
        answer(0);
        await tick();
        expect(watch.listenerCount()).toBe(0);
        expect(watch.hasAudience()).toBe(true);
        expect(edges).toEqual([true]);

        answer(1);
        await tick();
        expect(watch.hasAudience()).toBe(true);
        expect(edges).toEqual([true]);

        watch.stop();
    });

    it('gives up the audience once the linger window has passed', async () => {
        const { stats, answer } = stubStats(2);
        const watch = new AudienceWatch(stats, config, logger);
        const edges: boolean[] = [];
        watch.onChange(present => edges.push(present));

        watch.start();
        await tick(0);

        answer(0);
        await tick(65_000);

        expect(watch.hasAudience()).toBe(false);
        expect(edges).toEqual([true, false]);
        watch.stop();
    });

    it('holds the last reading when Icecast stops answering', async () => {
        const { stats, answer } = stubStats(3);
        const watch = new AudienceWatch(stats, config, logger);

        watch.start();
        await tick(0);

        // An unreachable Icecast is not evidence that everybody left. The count stands
        // and the linger window keeps running, so a brief outage mid-track does not
        // read as the audience vanishing at once.
        answer(undefined);
        await tick();

        expect(watch.listenerCount()).toBe(3);
        expect(watch.hasAudience()).toBe(true);
        watch.stop();
    });

    it('holds the gate open in `always` mode, with nobody listening', async () => {
        const { stats } = stubStats(0);
        const station = settingsConfig();
        const watch = new AudienceWatch(stats, station.config, logger);

        expect(watch.gateOpen()).toBe(false);

        station.set(AIR_MODE_KEY, 'always');

        // No restart, no re-read, nothing told: the mode is read from the config at the moment it
        // is asked, so a settings row written by an operator is in force on the next question.
        expect(watch.gateOpen()).toBe(true);
        // The count itself is unchanged: `always` is a decision about the mount, not a
        // claim that somebody is out there.
        expect(watch.listenerCount()).toBe(0);
    });

    it('announces a mode change on the next poll, having had no event to announce it on', async () => {
        const { stats } = stubStats(0);
        const station = settingsConfig();
        const watch = new AudienceWatch(stats, station.config, logger);
        const edges: boolean[] = [];
        watch.onChange(open => edges.push(open));

        watch.start();
        await tick(0);
        expect(edges).toEqual([]);

        // The write happens somewhere else entirely — a route, or psql — so nothing calls in here
        // to say so. The poll is what notices, which is why it re-evaluates the gate every time
        // rather than only when a reading changed.
        station.set(AIR_MODE_KEY, 'always');
        await tick();
        expect(edges).toEqual([true]);

        station.set(AIR_MODE_KEY, 'audience');
        await tick();
        expect(edges).toEqual([true, false]);

        watch.stop();
    });

    it('does not close the gate on an empty room in `always` mode', async () => {
        const { stats, answer } = stubStats(2);
        const station = settingsConfig({ [AIR_MODE_KEY]: 'always' });
        const watch = new AudienceWatch(stats, station.config, logger);
        const edges: boolean[] = [];
        watch.onChange(open => edges.push(open));

        watch.start();
        await tick(0);
        answer(0);
        await tick(120_000);

        expect(watch.gateOpen()).toBe(true);
        // Opened once when the first poll evaluated the gate, and never closed: two minutes of an
        // empty mount is well past the linger window, which is exactly what `always` overrides.
        expect(edges).toEqual([true]);
        watch.stop();
    });

    it('takes a pushed count without waiting for the poll', () => {
        const { stats } = stubStats(0);
        const watch = new AudienceWatch(stats, config, logger);
        const edges: boolean[] = [];
        watch.onChange(present => edges.push(present));

        watch.report(1);

        expect(watch.listenerCount()).toBe(1);
        expect(watch.hasAudience()).toBe(true);
        expect(edges).toEqual([true]);
    });

    it('opens the gate on an arrival, before Icecast can even count it', async () => {
        // Icecast is still holding the listener's connection when it tells us, so it
        // has not counted them yet: a poll here would read the old number, and the
        // station would stay silent for exactly as long as the person is waiting to
        // hear it.
        const { stats } = stubStats(0);
        const watch = new AudienceWatch(stats, config, logger);
        watch.start();
        await tick(0);

        watch.noteArrival(true);

        expect(watch.listenerCount()).toBe(1);
        expect(watch.gateOpen()).toBe(true);
        watch.stop();
    });

    it('replaces the guess with a real reading a moment later', async () => {
        const { stats, answer } = stubStats(0);
        const watch = new AudienceWatch(stats, config, logger);
        watch.start();
        await tick(0);

        // Two arrive, and Icecast turns out to hold three: something connected without
        // a hook, or one was dropped. The poll is the number, always.
        watch.noteArrival(true);
        watch.noteArrival(true);
        expect(watch.listenerCount()).toBe(2);

        answer(3);
        await tick(1_500);

        expect(watch.listenerCount()).toBe(3);
        watch.stop();
    });

    it('coalesces a burst of arrivals into one reading', async () => {
        const { stats, spy } = stubStats(0);
        const watch = new AudienceWatch(stats, config, logger);
        watch.start();
        await tick(0);
        const before = spy.listeners.mock.calls.length;

        for (let i = 0; i < 10; i++) watch.noteArrival(true);
        await tick(1_500);

        expect(spy.listeners.mock.calls.length).toBe(before + 1);
        watch.stop();
    });

    it('never counts below nobody', async () => {
        // A `remove` for a listener this process never saw arrive: an app that started
        // after them, or an event whose partner was dropped.
        const { stats } = stubStats(0);
        const watch = new AudienceWatch(stats, config, logger);

        watch.noteArrival(false);

        expect(watch.listenerCount()).toBe(0);
    });

    it('keeps announcing to the other subscribers when one of them throws', async () => {
        const { stats, answer } = stubStats(0);
        const watch = new AudienceWatch(stats, config, logger);
        const seen: boolean[] = [];
        watch.onChange(() => {
            throw new Error('a subscriber that cannot cope');
        });
        watch.onChange(present => seen.push(present));

        watch.start();
        await tick(0);
        answer(1);
        await tick();

        expect(seen).toEqual([true]);
        watch.stop();
    });

    it('stops reading once stopped', async () => {
        const { stats, spy } = stubStats(1);
        const watch = new AudienceWatch(stats, config, logger);

        watch.start();
        await tick(0);
        const reads = spy.listeners.mock.calls.length;

        watch.stop();
        await tick(20_000);

        expect(spy.listeners.mock.calls.length).toBe(reads);
    });
});
