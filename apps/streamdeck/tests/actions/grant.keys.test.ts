import { SdkError } from '@deadair/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GrantKeys } from '../../src/actions/grant.keys.js';
import { grantView } from '../../src/actions/grant.reading.js';
import { grantSvg, svgDataUri } from '../../src/display/key.image.js';
import { WaitingPoller } from '../../src/station/waiting.requests.js';
import { fakeDesk, waitingRequest } from '../fixtures/fake.desk.js';
import { fakeKey } from '../fixtures/fake.key.js';

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

const newer = waitingRequest('r2', 'Heroin');
const older = waitingRequest('r1', 'Pale Blue Eyes');

async function deck(line = [newer, older]) {
    const station = fakeDesk(line);
    const poller = new WaitingPoller();
    poller.reconfigure(station.desk);
    const log = vi.fn();
    const keys = new GrantKeys(poller, log);
    const key = fakeKey('grant');
    keys.appear(key);
    await vi.advanceTimersByTimeAsync(0);
    return { ...station, keys, key, log };
}

const last = (calls: string[], what: string): string | undefined => calls.filter(call => call.startsWith(what)).at(-1);
const faint = `image ${svgDataUri(grantSvg({ dim: true }))}`;
const counting = (count: number): string => `image ${svgDataUri(grantSvg({ dim: false, count }))}`;

describe('grantView', () => {
    it('counts the line and offers the request that has waited longest', () => {
        const view = grantView({
            waiting: [
                { id: 'r1', title: 'Pale Blue Eyes', artist: 'x' },
                { id: 'r2', title: 'Heroin', artist: 'x' },
            ],
            stale: false,
        });
        expect(view).toEqual({ dim: false, count: 2, press: { id: 'r1', title: 'Pale Blue Eyes' } });
    });

    it('refuses with nothing waiting, and on a failed or stale reading', () => {
        expect(grantView({ waiting: [], stale: false })).toEqual({ dim: true, refusal: 'No request is waiting for approval.' });
        expect(grantView({ stale: false })).toMatchObject({ dim: true, refusal: expect.stringMatching(/has not said yet/) });
        expect(grantView({ waiting: [{ id: 'r1', title: 't', artist: 'a' }], failure: 'unreachable', stale: true })).toMatchObject({
            dim: true,
            refusal: expect.stringMatching(/did not answer/),
        });
    });
});

describe('GrantKeys', () => {
    it('badges the count, sends no title, and lets the oldest through on a press', async () => {
        const { keys, key, desk } = await deck();
        expect(last(key.calls, 'image')).toBe(counting(2));

        await keys.press('grant');
        expect(desk.grantRequest).toHaveBeenCalledWith('r1');
        expect(key.calls).toContain('ok');
        expect(last(key.calls, 'image')).toBe(counting(1));
        expect(key.calls.some(call => call.startsWith('title'))).toBe(false);
    });

    it('draws one "9+" face for every count past nine', async () => {
        const line = Array.from({ length: 12 }, (_, i) => waitingRequest(`r${i}`, `Record ${i}`));
        const { key } = await deck(line);
        expect(last(key.calls, 'image')).toBe(counting(10));
        expect(counting(10)).toBe(counting(12));
    });

    it('goes faint with nothing waiting, asks nothing on a press, and says why in the log', async () => {
        const { keys, key, desk, log } = await deck([]);
        expect(last(key.calls, 'image')).toBe(faint);

        await keys.press('grant');
        expect(desk.grantRequest).not.toHaveBeenCalled();
        expect(key.calls.at(-1)).toBe('alert');
        expect(log).toHaveBeenCalledWith('No request is waiting for approval.');
    });

    it('says a Read-only key may not grant, in words of its own', async () => {
        const { keys, key, desk, log } = await deck();
        desk.grantRequest.mockRejectedValue(new SdkError(403, 'Forbidden', {}, new Headers()));

        await keys.press('grant');
        expect(key.calls.at(-1)).toBe('alert');
        expect(log.mock.calls[0]?.[0]).toMatch(/Granting needs a key with Read and manage/);
    });

    it('says somebody decided first when the request was no longer waiting, and shows the line as it is', async () => {
        const { keys, key, log, set } = await deck();
        set([newer]);

        await keys.press('grant');
        expect(key.calls).toContain('alert');
        expect(log.mock.calls[0]?.[0]).toMatch(/“Pale Blue Eyes” was no longer waiting/);
        await vi.advanceTimersByTimeAsync(0);
        expect(last(key.calls, 'image')).toBe(counting(1));
    });

    it('stops asking once its last key goes', async () => {
        const { keys, desk } = await deck();
        keys.disappear('grant');
        await vi.advanceTimersByTimeAsync(60_000);
        expect(desk.listRequests).toHaveBeenCalledTimes(1);
    });
});
