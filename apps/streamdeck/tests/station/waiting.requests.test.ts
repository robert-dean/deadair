import { SdkError } from '@deadair/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WAITING_INTERVAL_MS, WaitingPoller, type WaitingReading } from '../../src/station/waiting.requests.js';
import { fakeDesk, waitingRequest } from '../fixtures/fake.desk.js';

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

const newer = waitingRequest('r2', 'Heroin');
const older = waitingRequest('r1', 'Pale Blue Eyes');

function watch(poller: WaitingPoller): WaitingReading[] {
    const readings: WaitingReading[] = [];
    poller.subscribe(reading => readings.push(reading));
    return readings;
}

describe('WaitingPoller', () => {
    it('asks for the waiting requests only while a key holds it, and lists them oldest first', async () => {
        const { desk } = fakeDesk([newer, older]);
        const poller = new WaitingPoller();
        poller.reconfigure(desk);
        await vi.advanceTimersByTimeAsync(WAITING_INTERVAL_MS * 2);
        expect(desk.listRequests).not.toHaveBeenCalled();

        const release = poller.acquire();
        await vi.advanceTimersByTimeAsync(0);
        expect(desk.listRequests).toHaveBeenCalledWith({ status: 'waiting' });
        expect(poller.current.waiting?.map(request => request.id)).toEqual(['r1', 'r2']);

        await vi.advanceTimersByTimeAsync(WAITING_INTERVAL_MS);
        expect(desk.listRequests).toHaveBeenCalledTimes(2);

        release();
        await vi.advanceTimersByTimeAsync(WAITING_INTERVAL_MS * 3);
        expect(desk.listRequests).toHaveBeenCalledTimes(2);
    });

    it('keeps the last line through a failure and marks it stale, then backs off', async () => {
        const { desk } = fakeDesk([older]);
        const poller = new WaitingPoller();
        poller.reconfigure(desk);
        poller.acquire();
        await vi.advanceTimersByTimeAsync(0);

        desk.listRequests.mockRejectedValue(new SdkError(503, 'Unavailable', {}, new Headers()));
        await vi.advanceTimersByTimeAsync(WAITING_INTERVAL_MS);
        expect(poller.current).toEqual({
            waiting: [{ id: 'r1', title: 'Pale Blue Eyes', artist: 'The Velvet Underground' }],
            failure: 'unreachable',
            stale: true,
        });

        // The second failure waits twice the interval.
        await vi.advanceTimersByTimeAsync(WAITING_INTERVAL_MS);
        expect(desk.listRequests).toHaveBeenCalledTimes(3);
        await vi.advanceTimersByTimeAsync(WAITING_INTERVAL_MS);
        expect(desk.listRequests).toHaveBeenCalledTimes(3);
        await vi.advanceTimersByTimeAsync(WAITING_INTERVAL_MS);
        expect(desk.listRequests).toHaveBeenCalledTimes(4);
    });

    it('takes a granted request out of the line at once, and reads the line again', async () => {
        const { desk } = fakeDesk([newer, older]);
        const poller = new WaitingPoller();
        poller.reconfigure(desk);
        poller.acquire();
        await vi.advanceTimersByTimeAsync(0);
        const readings = watch(poller);

        await poller.grant('r1');
        expect(desk.grantRequest).toHaveBeenCalledWith('r1');
        expect(readings.at(-1)?.waiting?.map(request => request.id)).toEqual(['r2']);
        await vi.advanceTimersByTimeAsync(0);
        expect(desk.listRequests).toHaveBeenCalledTimes(2);
    });

    it('drops an answer from a station that has since been replaced', async () => {
        const first = fakeDesk([older]);
        let answer: (value: { requests: never[] }) => void = () => undefined;
        first.desk.listRequests.mockImplementation(() => new Promise(resolve => (answer = resolve)) as never);
        const poller = new WaitingPoller();
        poller.reconfigure(first.desk);
        poller.acquire();
        await vi.advanceTimersByTimeAsync(0);

        const second = fakeDesk([newer]);
        poller.reconfigure(second.desk);
        await vi.advanceTimersByTimeAsync(0);
        answer({ requests: [] });
        await vi.advanceTimersByTimeAsync(0);
        expect(poller.current.waiting?.map(request => request.id)).toEqual(['r2']);
    });

    it('says there is no station while none is set up', () => {
        const poller = new WaitingPoller();
        poller.reconfigure(undefined);
        expect(poller.current).toEqual({ failure: 'unconfigured', stale: false });
    });
});
