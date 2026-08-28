// The audience is what the mount lease will be held on, so the interesting cases are
// all about what this class does with an ABSENT reading: a player reconnecting, an
// Icecast that went away, a count that never arrived. Reporting "no audience" too
// eagerly cuts a broadcast somebody is listening to; reporting one too readily airs a
// station to an empty room.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AUDIENCE_POLL_MS, AudienceWatch } from '../../../src/modules/playout/audience.watch.js';
import { Heartbeat } from '../../../src/modules/shared/heartbeat.js';
import { StationBus } from '../../../src/modules/shared/station.bus.js';
import { AIR_MODE_KEY } from '../../../src/modules/playout/air.mode.js';
import { settingsConfig } from '../../utils/settings.config.js';
import type { IcecastStatsClient } from '../../../src/modules/stream/icecast.stats.client.js';
import type { IcecastEventFeed } from '../../../src/modules/stream/icecast.eventfeed.client.js';
import type { Logger } from '@maroonedsoftware/logger';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

/** The default station: `audience` mode, because nothing is stored. Never mutated. */
const { config } = settingsConfig();

/**
 * A stats client whose answer the test moves, including to "did not answer".
 *
 * `listeners` answers the TOTAL across every mount, which is the whole of what this
 * class is handed: reconciling one mount's event against the others is the stats
 * client's job, and doing it in a second place is how the two would come to disagree.
 */
function stubStats(initial: number | undefined, mounts: string[] = ['/live.mp3']) {
    let answer = initial;
    const stats = {
        listeners: vi.fn(async () => answer),
        mountPath: () => mounts[0] ?? '/live.mp3',
        mountPaths: () => mounts,
        listenersByMount: () => new Map(mounts.map(mount => [mount, 0])),
    };
    return {
        stats: stats as unknown as IcecastStatsClient,
        spy: stats,
        answer: (next: number | undefined) => {
            answer = next;
        },
    };
}

/**
 * An event feed that never attaches, which is every install on the pinned 2.4.
 *
 * The feed's own behaviour is tested where it lives; what matters here is that
 * the poll is the truth with or without one, so these tests deliberately run
 * without it.
 */
const feed = () => ({ watch: vi.fn(), stop: vi.fn(), attached: () => false }) as unknown as IcecastEventFeed;

/** A real bus over the stub logger: publishing is what half of these cases are checking. */
const bus = () => new StationBus(logger);

/**
 * One poll cycle: advance to the interval and let the awaited read settle.
 *
 * Derived from the constant rather than restated, because the poll is a failsafe now and its
 * interval moved from five seconds to a minute — a literal here would have gone on passing while
 * testing nothing.
 */
async function tick(ms = AUDIENCE_POLL_MS): Promise<void> {
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
        const watch = new AudienceWatch(stats, feed(), config, new Heartbeat(), bus(), logger);

        expect(watch.listenerCount()).toBe(0);
        expect(watch.hasAudience()).toBe(false);
    });

    it('has an audience as soon as somebody is listening', async () => {
        const { stats, answer } = stubStats(0);
        const watch = new AudienceWatch(stats, feed(), config, new Heartbeat(), bus(), logger);
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
        const watch = new AudienceWatch(stats, feed(), config, new Heartbeat(), bus(), logger);
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
        const watch = new AudienceWatch(stats, feed(), config, new Heartbeat(), bus(), logger);
        const edges: boolean[] = [];
        watch.onChange(present => edges.push(present));

        watch.start();
        await tick(0);

        answer(0);
        // Comfortably past the five-minute linger.
        await tick(6 * 60_000);

        expect(watch.hasAudience()).toBe(false);
        expect(edges).toEqual([true, false]);
        watch.stop();
    });

    it('holds the last reading when Icecast stops answering', async () => {
        const { stats, answer } = stubStats(3);
        const watch = new AudienceWatch(stats, feed(), config, new Heartbeat(), bus(), logger);

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

    describe('the reading, and whether it is worth anything', () => {
        // `listenerCount()` answers zero both for an empty room and for an Icecast that is
        // not answering. The gate cannot tell them apart and must not — an app with no
        // evidence anybody is there should not air — but in `audience` mode the second one
        // is permanent silence, so the station has to be able to SAY which it is.

        it('has never been read before Icecast answers', () => {
            const { stats } = stubStats(undefined);
            const watch = new AudienceWatch(stats, feed(), config, new Heartbeat(), bus(), logger);

            expect(watch.reading().readAt).toBeUndefined();
        });

        it('records when Icecast answered, including with nobody listening', async () => {
            const { stats } = stubStats(0);
            const watch = new AudienceWatch(stats, feed(), config, new Heartbeat(), bus(), logger);

            watch.start();
            await tick(0);

            // A reported zero is a real answer. This is the whole distinction: an empty
            // room is evidence, and a failed request is not.
            expect(watch.reading()).toEqual({ count: 0, hasAudience: false, readAt: Date.now() });
            watch.stop();
        });

        it('stops moving when Icecast stops answering, while the count stands', async () => {
            const { stats, answer } = stubStats(2);
            const watch = new AudienceWatch(stats, feed(), config, new Heartbeat(), bus(), logger);

            watch.start();
            await tick(0);
            const answeredAt = watch.reading().readAt;

            answer(undefined);
            await tick(30_000);

            expect(watch.reading().count).toBe(2);
            expect(watch.reading().readAt).toBe(answeredAt);
            watch.stop();
        });

        it('counts a pushed event as Icecast being alive', async () => {
            // An event feed message, or a hook call Icecast is holding a listener's
            // connection open for, is proof it is up whether or not a poll landed.
            const { stats } = stubStats(undefined);
            const watch = new AudienceWatch(stats, feed(), config, new Heartbeat(), bus(), logger);

            watch.start();
            await tick(0);
            expect(watch.reading().readAt).toBeUndefined();

            watch.report(4);

            expect(watch.reading().readAt).toBe(Date.now());
            watch.stop();
        });

        it('counts a feed message as Icecast being alive too', async () => {
            // The poll is a failsafe now, so on a healthy station this is usually the only
            // thing proving Icecast is there.
            const { stats } = stubStats(undefined);
            const watch = new AudienceWatch(stats, feed(), config, new Heartbeat(), bus(), logger);

            watch.start();
            await tick(0);

            watch.report(1);

            expect(watch.reading().readAt).toBe(Date.now());
            watch.stop();
        });
    });

    it('holds the gate open in `always` mode, with nobody listening', async () => {
        const { stats } = stubStats(0);
        const station = settingsConfig();
        const watch = new AudienceWatch(stats, feed(), station.config, new Heartbeat(), bus(), logger);

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
        const watch = new AudienceWatch(stats, feed(), station.config, new Heartbeat(), bus(), logger);
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
        const watch = new AudienceWatch(stats, feed(), station.config, new Heartbeat(), bus(), logger);
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
        const watch = new AudienceWatch(stats, feed(), config, new Heartbeat(), bus(), logger);
        const edges: boolean[] = [];
        watch.onChange(present => edges.push(present));

        watch.report(1);

        expect(watch.listenerCount()).toBe(1);
        expect(watch.hasAudience()).toBe(true);
        expect(edges).toEqual([true]);
    });

    it('opens the gate the moment the feed reports somebody, without waiting for a poll', async () => {
        // What the listener hooks used to be for. `source-listeners-changed` arrives within
        // milliseconds of the connection, so the minute-long poll is never in the path.
        const { stats } = stubStats(0);
        const watch = new AudienceWatch(stats, feed(), config, new Heartbeat(), bus(), logger);
        watch.start();
        await tick(0);

        watch.report(1);

        expect(watch.listenerCount()).toBe(1);
        expect(watch.gateOpen()).toBe(true);
        watch.stop();
    });

    it('follows every mount the station serves, not just the one it names', async () => {
        // The regression this whole seam exists for: with Opus published beside MP3, a
        // feed watching only the primary never hears about an Opus listener, and in
        // `audience` mode the station goes quiet with somebody demonstrably listening.
        const mounts = ['/live.mp3', '/live.opus', '/live.aac'];
        const { stats } = stubStats(0, mounts);
        const pushed = feed();
        const watch = new AudienceWatch(stats, pushed, config, new Heartbeat(), bus(), logger);

        watch.start();
        await tick(0);

        expect(vi.mocked(pushed.watch).mock.calls[0]?.[0]).toEqual(mounts);
        watch.stop();
    });

    it('opens the gate for a listener the poll has not read yet, wherever they are', async () => {
        // The feed hands over a TOTAL, already reconciled across the mounts, so this
        // class treats a message about Opus exactly as it treats one about MP3.
        const { stats } = stubStats(0, ['/live.mp3', '/live.opus']);
        const watch = new AudienceWatch(stats, feed(), config, new Heartbeat(), bus(), logger);
        watch.start();
        await tick(0);
        expect(watch.gateOpen()).toBe(false);

        watch.report(1);

        expect(watch.gateOpen()).toBe(true);
        watch.stop();
    });

    it('never counts below nobody', async () => {
        // A negative from anything that reports one: the count is clamped rather than
        // trusted, since a linger window measured against a negative never expires.
        const { stats } = stubStats(0);
        const watch = new AudienceWatch(stats, feed(), config, new Heartbeat(), bus(), logger);

        watch.report(-2);

        expect(watch.listenerCount()).toBe(0);
    });

    it('keeps announcing to the other subscribers when one of them throws', async () => {
        const { stats, answer } = stubStats(0);
        const watch = new AudienceWatch(stats, feed(), config, new Heartbeat(), bus(), logger);
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

    // The arrival edge, which is a different fact from the gate and is why it is announced
    // separately: in `always` mode the gate never moves, so a station on that setting could never
    // greet anybody if this were derived from it.
    it('announces somebody walking into an empty room, once', async () => {
        const { stats, answer } = stubStats(0);
        const station = new StationBus(logger);
        const arrivals: number[] = [];
        station.subscribe('audience.arrived', event => arrivals.push(event.count));
        const watch = new AudienceWatch(stats, feed(), config, new Heartbeat(), station, logger);

        watch.start();
        await tick(0);
        expect(arrivals).toEqual([]);

        answer(1);
        await tick();
        // A second listener joining a room that already had one is not an arrival into an empty
        // room, and greeting them would be the station talking to the person already there.
        answer(2);
        await tick();

        expect(arrivals).toEqual([1]);
        watch.stop();
    });

    it('announces the next arrival after the room has emptied', async () => {
        const { stats, answer } = stubStats(1);
        const station = new StationBus(logger);
        const arrivals: number[] = [];
        station.subscribe('audience.arrived', event => arrivals.push(event.count));
        const watch = new AudienceWatch(stats, feed(), config, new Heartbeat(), station, logger);

        watch.start();
        await tick(0);
        answer(0);
        await tick();
        answer(1);
        await tick();

        expect(arrivals).toEqual([1, 1]);
        watch.stop();
    });

    it('keeps polling when a subscriber throws', async () => {
        // A greeting that could not be requested must never cost the loop that noticed the listener.
        const { stats, answer, spy } = stubStats(0);
        const station = new StationBus(logger);
        station.subscribe('audience.arrived', () => {
            throw new Error('the director is gone');
        });
        const watch = new AudienceWatch(stats, feed(), config, new Heartbeat(), station, logger);

        watch.start();
        await tick(0);
        answer(1);
        await tick();
        const reads = spy.listeners.mock.calls.length;

        await tick();

        expect(watch.listenerCount()).toBe(1);
        expect(spy.listeners.mock.calls.length).toBeGreaterThan(reads);
        watch.stop();
    });

    it('stops reading once stopped', async () => {
        const { stats, spy } = stubStats(1);
        const watch = new AudienceWatch(stats, feed(), config, new Heartbeat(), bus(), logger);

        watch.start();
        await tick(0);
        const reads = spy.listeners.mock.calls.length;

        watch.stop();
        await tick(20_000);

        expect(spy.listeners.mock.calls.length).toBe(reads);
    });
});
