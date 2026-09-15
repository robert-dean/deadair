import { SdkError } from '@deadair/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SkipKeys } from '../../src/actions/skip.keys.js';
import { fakeKey } from '../fixtures/fake.key.js';
import { fakeStation } from '../fixtures/fake.station.js';
import { airing, stoodDown } from '../fixtures/playout.status.js';

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

async function showing(station: ReturnType<typeof fakeStation>) {
    const log = vi.fn();
    const skip = new SkipKeys(station.poller, log);
    const key = fakeKey('skip');
    skip.appear(key);
    await vi.advanceTimersByTimeAsync(0);
    return { skip, key, log };
}

describe('SkipKeys', () => {
    it('skips what is on air, and ticks', async () => {
        const station = fakeStation();
        const { skip, key } = await showing(station);
        await skip.press('skip');
        expect(station.playout.skipTheCurrentItem).toHaveBeenCalledTimes(1);
        expect(key.calls).toContain('ok');
    });

    it('refuses a press with nothing to end, and asks the station nothing', async () => {
        const station = fakeStation(stoodDown());
        const { skip, key } = await showing(station);
        await skip.press('skip');
        expect(station.playout.skipTheCurrentItem).not.toHaveBeenCalled();
        expect(key.calls).toContain('alert');
    });

    it('refuses a press on a reading that is stale', async () => {
        const station = fakeStation();
        const { skip, key } = await showing(station);
        station.playout.getPlayoutStatus.mockRejectedValue(new TypeError('fetch failed'));
        await vi.advanceTimersByTimeAsync(2_000);
        await skip.press('skip');
        expect(station.playout.skipTheCurrentItem).not.toHaveBeenCalled();
        expect(key.calls).toContain('alert');
        expect(key.calls).toContain('title No station');
    });

    it('says in the log why a read-only key was refused', async () => {
        const station = fakeStation();
        station.playout.skipTheCurrentItem.mockRejectedValueOnce(new SdkError(403, 'Forbidden', {}, new Headers()));
        const { skip, key, log } = await showing(station);
        await skip.press('skip');
        expect(key.calls).toContain('alert');
        expect(log).toHaveBeenCalledWith(expect.stringContaining('Read and manage'));
    });

    it('ignores a second press while the first is still going', async () => {
        const station = fakeStation();
        let finish: () => void = () => undefined;
        station.playout.skipTheCurrentItem.mockImplementationOnce(() => new Promise(resolve => (finish = () => resolve(airing()))));
        const { skip } = await showing(station);
        const first = skip.press('skip');
        await skip.press('skip');
        finish();
        await first;
        expect(station.playout.skipTheCurrentItem).toHaveBeenCalledTimes(1);
    });
});
