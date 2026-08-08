// The audience is what the mount lease will be held on, so the interesting cases are
// all about what this class does with an ABSENT reading: a player reconnecting, an
// Icecast that went away, a count that never arrived. Reporting "no audience" too
// eagerly cuts a broadcast somebody is listening to; reporting one too readily airs a
// station to an empty room.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AudienceWatch } from '../../../src/modules/playout/audience.watch.js';
import type { IcecastStatsClient } from '../../../src/modules/stream/icecast.stats.client.js';
import type { Logger } from '@maroonedsoftware/logger';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

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
        const watch = new AudienceWatch(stats, logger);

        expect(watch.listenerCount()).toBe(0);
        expect(watch.hasAudience()).toBe(false);
    });

    it('has an audience as soon as somebody is listening', async () => {
        const { stats, answer } = stubStats(0);
        const watch = new AudienceWatch(stats, logger);
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
        const watch = new AudienceWatch(stats, logger);
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
        const watch = new AudienceWatch(stats, logger);
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
        const watch = new AudienceWatch(stats, logger);

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

    it('takes a pushed count without waiting for the poll', () => {
        const { stats } = stubStats(0);
        const watch = new AudienceWatch(stats, logger);
        const edges: boolean[] = [];
        watch.onChange(present => edges.push(present));

        watch.report(1);

        expect(watch.listenerCount()).toBe(1);
        expect(watch.hasAudience()).toBe(true);
        expect(edges).toEqual([true]);
    });

    it('keeps announcing to the other subscribers when one of them throws', async () => {
        const { stats, answer } = stubStats(0);
        const watch = new AudienceWatch(stats, logger);
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
        const watch = new AudienceWatch(stats, logger);

        watch.start();
        await tick(0);
        const reads = spy.listeners.mock.calls.length;

        watch.stop();
        await tick(20_000);

        expect(spy.listeners.mock.calls.length).toBe(reads);
    });
});
