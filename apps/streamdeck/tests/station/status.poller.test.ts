import { SdkError, type PlayoutStatus } from '@deadair/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NotConfigured } from '../../src/station/connection.failure.js';
import { POLL_INTERVAL_MS, StatusPoller, type Playout, type Reading } from '../../src/station/status.poller.js';
import { airing, record as airingRecord, stoodDown } from '../fixtures/playout.status.js';

/** A station whose next answers the test decides. */
function fakePlayout(answers: Array<PlayoutStatus | Error> = []) {
    const getPlayoutStatus = vi.fn(async (): Promise<PlayoutStatus> => {
        const next = answers.length > 1 ? answers.shift()! : answers[0];
        if (next === undefined) return airing();
        if (next instanceof Error) throw next;
        return next;
    });
    const playout: Playout = {
        getPlayoutStatus,
        skipTheCurrentItem: vi.fn(async () => airing()),
        startPlayout: vi.fn(async () => airing()),
        stopPlayout: vi.fn(async () => stoodDown()),
    };
    return { playout, getPlayoutStatus };
}

function record(poller: StatusPoller): Reading[] {
    const readings: Reading[] = [];
    poller.subscribe(reading => readings.push(reading));
    return readings;
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('StatusPoller', () => {
    it('says there is no station until it is given one', () => {
        const poller = new StatusPoller();
        expect(poller.current).toEqual({ failure: 'unconfigured', stale: false });
    });

    it('asks nothing until a key holds it, and asks at once when one does', async () => {
        const { playout, getPlayoutStatus } = fakePlayout();
        const poller = new StatusPoller();
        poller.reconfigure(playout);
        await vi.advanceTimersByTimeAsync(10_000);
        expect(getPlayoutStatus).not.toHaveBeenCalled();

        poller.acquire();
        await vi.advanceTimersByTimeAsync(0);
        expect(getPlayoutStatus).toHaveBeenCalledTimes(1);
        expect(poller.current.status).toEqual(airing());
    });

    it('asks every five seconds while held, once for every key holding it', async () => {
        const { playout, getPlayoutStatus } = fakePlayout();
        const poller = new StatusPoller();
        poller.reconfigure(playout);
        poller.acquire();
        poller.acquire();
        poller.acquire();
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(3 * POLL_INTERVAL_MS);
        expect(getPlayoutStatus).toHaveBeenCalledTimes(4);
    });

    it('stops when the last key lets go, and a release twice counts once', async () => {
        const { playout, getPlayoutStatus } = fakePlayout();
        const poller = new StatusPoller();
        poller.reconfigure(playout);
        const first = poller.acquire();
        const second = poller.acquire();
        await vi.advanceTimersByTimeAsync(0);
        first();
        first();
        await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
        expect(getPlayoutStatus).toHaveBeenCalledTimes(2);

        second();
        await vi.advanceTimersByTimeAsync(20_000);
        expect(getPlayoutStatus).toHaveBeenCalledTimes(2);
    });

    it('gives a key that subscribes the current reading straight away', async () => {
        const { playout } = fakePlayout();
        const poller = new StatusPoller();
        poller.reconfigure(playout);
        poller.acquire();
        await vi.advanceTimersByTimeAsync(0);
        const readings = record(poller);
        expect(readings).toHaveLength(1);
        expect(readings[0]!.status).toEqual(airing());
    });

    it('keeps the last reading through a failure and marks it stale', async () => {
        const { playout } = fakePlayout([airing(), new TypeError('fetch failed')]);
        const poller = new StatusPoller();
        poller.reconfigure(playout);
        poller.acquire();
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
        expect(poller.current).toMatchObject({ status: airing(), failure: 'unreachable', stale: true });
    });

    it('reports a failure with nothing to keep as not stale', async () => {
        const { playout } = fakePlayout([new SdkError(401, 'Unauthorized', {}, new Headers())]);
        const poller = new StatusPoller();
        poller.reconfigure(playout);
        poller.acquire();
        await vi.advanceTimersByTimeAsync(0);
        expect(poller.current).toEqual({ failure: 'unauthorised', stale: false });
    });

    it('backs off while the station fails, doubling to thirty seconds, and recovers to five', async () => {
        const failure = new TypeError('fetch failed');
        const { playout, getPlayoutStatus } = fakePlayout([failure]);
        const poller = new StatusPoller();
        poller.reconfigure(playout);
        poller.acquire();

        const times: number[] = [];
        getPlayoutStatus.mockImplementation(async () => {
            times.push(Date.now());
            throw failure;
        });
        const start = Date.now();
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(120_000);
        const gaps = times.slice(1).map((time, index) => time - times[index]!);
        expect(times[0]).toBe(start);
        expect(gaps.slice(0, 5)).toEqual([5_000, 10_000, 20_000, 30_000, 30_000]);

        getPlayoutStatus.mockImplementation(async () => {
            times.push(Date.now());
            return airing();
        });
        times.length = 0;
        // The last failure, at 95 seconds, waits out thirty: the station is next asked at 125.
        await vi.advanceTimersByTimeAsync(5_000);
        await vi.advanceTimersByTimeAsync(2 * POLL_INTERVAL_MS);
        expect(times.slice(1).map((time, index) => time - times[index]!)).toEqual([POLL_INTERVAL_MS, POLL_INTERVAL_MS]);
    });

    it('asks again just after the record on air is due to end, when that comes before the interval', async () => {
        const next = { ...airingRecord, id: 'item-2' };
        const { playout, getPlayoutStatus } = fakePlayout([
            airing({ nowPlaying: { item: airingRecord, startedAt: 1_000, remainingMs: 1_200 } }),
            airing({ nowPlaying: { item: next, startedAt: 2_000, remainingMs: 300_000 } }),
        ]);
        const poller = new StatusPoller();
        poller.reconfigure(playout);
        poller.acquire();
        await vi.advanceTimersByTimeAsync(0);
        expect(getPlayoutStatus).toHaveBeenCalledTimes(1);

        // 1.2 seconds left and a 750ms margin: the station is asked at 1.95 seconds, not at five.
        await vi.advanceTimersByTimeAsync(1_949);
        expect(getPlayoutStatus).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(getPlayoutStatus).toHaveBeenCalledTimes(2);
        expect(poller.current.status?.nowPlaying?.item.id).toBe('item-2');

        // The new record has minutes left, so the next reading is the ordinary one.
        await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS - 1);
        expect(getPlayoutStatus).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(1);
        expect(getPlayoutStatus).toHaveBeenCalledTimes(3);
    });

    it('times one reading to a record’s end, and does not chase a countdown that stays at zero', async () => {
        const { playout, getPlayoutStatus } = fakePlayout([airing({ nowPlaying: { item: airingRecord, startedAt: 1_000, remainingMs: 0 } })]);
        const poller = new StatusPoller();
        poller.reconfigure(playout);
        poller.acquire();
        const times: number[] = [];
        getPlayoutStatus.mockImplementation(async () => {
            times.push(Date.now());
            return airing({ nowPlaying: { item: airingRecord, startedAt: 1_000, remainingMs: 0 } });
        });
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(750 + 2 * POLL_INTERVAL_MS);
        expect(times.slice(1).map((time, index) => time - times[index]!)).toEqual([750, POLL_INTERVAL_MS, POLL_INTERVAL_MS]);
    });

    it('keeps to the interval when nothing on air has a countdown', async () => {
        const { playout, getPlayoutStatus } = fakePlayout([stoodDown()]);
        const poller = new StatusPoller();
        poller.reconfigure(playout);
        poller.acquire();
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS - 1);
        expect(getPlayoutStatus).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(getPlayoutStatus).toHaveBeenCalledTimes(2);
    });

    it('waits as long as a 429 asks when that is longer than its own backoff', async () => {
        const limited = new SdkError(429, 'Too Many Requests', {}, new Headers({ 'retry-after': '9' }));
        const { playout, getPlayoutStatus } = fakePlayout([limited, airing()]);
        const poller = new StatusPoller();
        poller.reconfigure(playout);
        poller.acquire();
        await vi.advanceTimersByTimeAsync(0);
        expect(poller.current.failure).toBe('rateLimited');
        await vi.advanceTimersByTimeAsync(8_999);
        expect(getPlayoutStatus).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(getPlayoutStatus).toHaveBeenCalledTimes(2);
    });

    it('publishes what a command answers, then looks again at 400ms, 1s and 2.5s', async () => {
        const { playout, getPlayoutStatus } = fakePlayout();
        const poller = new StatusPoller({ intervalMs: 60_000 });
        poller.reconfigure(playout);
        poller.acquire();
        await vi.advanceTimersByTimeAsync(0);
        expect(getPlayoutStatus).toHaveBeenCalledTimes(1);

        await poller.command(station => station.stopPlayout());
        expect(poller.current.status).toEqual(stoodDown());
        await vi.advanceTimersByTimeAsync(400);
        expect(getPlayoutStatus).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(600);
        expect(getPlayoutStatus).toHaveBeenCalledTimes(3);
        await vi.advanceTimersByTimeAsync(1_500);
        expect(getPlayoutStatus).toHaveBeenCalledTimes(4);
    });

    it('lets a second command replace the first one’s follow-ups rather than stack on them', async () => {
        const { playout, getPlayoutStatus } = fakePlayout();
        const poller = new StatusPoller({ intervalMs: 60_000 });
        poller.reconfigure(playout);
        poller.acquire();
        await vi.advanceTimersByTimeAsync(0);

        await poller.command(station => station.skipTheCurrentItem());
        await vi.advanceTimersByTimeAsync(300);
        await poller.command(station => station.skipTheCurrentItem());
        await vi.advanceTimersByTimeAsync(2_500);
        expect(getPlayoutStatus).toHaveBeenCalledTimes(1 + 3);
    });

    it('throws a refused command to the key that asked, and leaves the reading alone', async () => {
        const { playout } = fakePlayout();
        const refused = new SdkError(403, 'Forbidden', {}, new Headers());
        vi.mocked(playout.skipTheCurrentItem).mockRejectedValueOnce(refused);
        const poller = new StatusPoller();
        poller.reconfigure(playout);
        poller.acquire();
        await vi.advanceTimersByTimeAsync(0);

        await expect(poller.command(station => station.skipTheCurrentItem())).rejects.toBe(refused);
        expect(poller.current).toMatchObject({ status: airing(), stale: false });
        expect(poller.current.failure).toBeUndefined();
    });

    it('refuses a command with no station', async () => {
        const poller = new StatusPoller();
        await expect(poller.command(station => station.skipTheCurrentItem())).rejects.toBeInstanceOf(NotConfigured);
    });

    it('drops the old station’s reading on a change, and an answer from it that lands late', async () => {
        let answer: (status: PlayoutStatus) => void = () => undefined;
        const slow: Playout = {
            ...fakePlayout().playout,
            getPlayoutStatus: () => new Promise<PlayoutStatus>(resolve => (answer = resolve)),
        };
        const { playout: next } = fakePlayout([stoodDown()]);
        const poller = new StatusPoller();
        poller.reconfigure(slow);
        poller.acquire();
        await vi.advanceTimersByTimeAsync(0);

        poller.reconfigure(next);
        expect(poller.current).toEqual({ stale: false });
        await vi.advanceTimersByTimeAsync(0);
        answer(airing());
        await vi.advanceTimersByTimeAsync(0);
        expect(poller.current.status).toEqual(stoodDown());
    });

    it('goes back to no station when the settings are cleared', async () => {
        const { playout } = fakePlayout();
        const poller = new StatusPoller();
        poller.reconfigure(playout);
        poller.acquire();
        await vi.advanceTimersByTimeAsync(0);
        poller.reconfigure(undefined);
        expect(poller.current).toEqual({ failure: 'unconfigured', stale: false });
    });
});
