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
const face = (dim: boolean): string => `image ${svgDataUri(grantSvg({ dim }))}`;

describe('grantView', () => {
    it('counts the line and offers the request that has waited longest', () => {
        const view = grantView({
            waiting: [
                { id: 'r1', title: 'Pale Blue Eyes', artist: 'x' },
                { id: 'r2', title: 'Heroin', artist: 'x' },
            ],
            stale: false,
        });
        expect(view).toEqual({ title: '2 waiting\nPale Blue…', dim: false, press: { id: 'r1', title: 'Pale Blue Eyes' } });
    });

    it('refuses with nothing waiting, and on a failed or stale reading', () => {
        expect(grantView({ waiting: [], stale: false })).toEqual({ title: 'None\nwaiting', dim: true });
        expect(grantView({ stale: false })).toEqual({ title: '', dim: true });
        expect(grantView({ waiting: [{ id: 'r1', title: 't', artist: 'a' }], failure: 'unreachable', stale: true })).toEqual({
            title: 'No station',
            dim: true,
        });
    });
});

describe('GrantKeys', () => {
    it('shows the line and lets the oldest through on a press', async () => {
        const { keys, key, desk } = await deck();
        expect(last(key.calls, 'title')).toBe('title 2 waiting\nPale Blue…');
        expect(last(key.calls, 'image')).toBe(face(false));

        await keys.press('grant');
        expect(desk.grantRequest).toHaveBeenCalledWith('r1');
        expect(key.calls).toContain('ok');
        expect(last(key.calls, 'title')).toBe('title 1 waiting\nHeroin');
    });

    it('goes faint with nothing waiting and asks nothing on a press', async () => {
        const { keys, key, desk } = await deck([]);
        expect(last(key.calls, 'title')).toBe('title None\nwaiting');
        expect(last(key.calls, 'image')).toBe(face(true));

        await keys.press('grant');
        expect(desk.grantRequest).not.toHaveBeenCalled();
        expect(key.calls.at(-1)).toBe('alert');
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
        expect(last(key.calls, 'title')).toBe('title 1 waiting\nHeroin');
    });

    it('stops asking once its last key goes', async () => {
        const { keys, desk } = await deck();
        keys.disappear('grant');
        await vi.advanceTimersByTimeAsync(60_000);
        expect(desk.listRequests).toHaveBeenCalledTimes(1);
    });
});
