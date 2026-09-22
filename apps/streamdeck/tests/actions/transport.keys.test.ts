import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ARMED_MS } from '../../src/actions/arming.js';
import { START, STOP, TransportKeys } from '../../src/actions/transport.keys.js';
import { fakeKey } from '../fixtures/fake.key.js';
import { fakeStation } from '../fixtures/fake.station.js';
import { stoodDown } from '../fixtures/playout.status.js';
import { POLL_INTERVAL_MS } from '../../src/station/status.poller.js';

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

async function showing(station: ReturnType<typeof fakeStation>, ...ids: string[]) {
    const log = vi.fn();
    const transport = new TransportKeys(station.poller, log);
    const keys = (ids.length ? ids : ['stop']).map(fakeKey);
    for (const key of keys) transport.appear(key);
    await vi.advanceTimersByTimeAsync(0);
    return { transport, keys, key: keys[0]!, log };
}

describe('TransportKeys', () => {
    it('is Stop while the station is on air, and Start once it is stood down', async () => {
        const station = fakeStation();
        const { key } = await showing(station);
        expect(key.calls).toContain(`state ${STOP}`);
        station.answer(stoodDown());
        await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
        expect(key.calls.at(-1)).toBe(`state ${START}`);
    });

    it('arms on the first press, saying so, and stops on the second', async () => {
        const station = fakeStation();
        const { transport, key } = await showing(station);
        await transport.press('stop');
        expect(station.playout.stopPlayout).not.toHaveBeenCalled();
        expect(key.calls).toContain('title Confirm');

        await transport.press('stop');
        expect(station.playout.stopPlayout).toHaveBeenCalledTimes(1);
        expect(key.calls).toContain('ok');
        expect(key.calls).toContain(`state ${START}`);
    });

    it('forgets the arm after five seconds, so a later press only arms again', async () => {
        const station = fakeStation();
        const { transport, key } = await showing(station);
        await transport.press('stop');
        await vi.advanceTimersByTimeAsync(ARMED_MS);
        expect(key.calls.at(-1)).toBe('title ');
        await transport.press('stop');
        expect(station.playout.stopPlayout).not.toHaveBeenCalled();
    });

    it('arms each key on its own', async () => {
        const station = fakeStation();
        const { transport, keys } = await showing(station, 'one', 'two');
        await transport.press('one');
        await transport.press('two');
        expect(station.playout.stopPlayout).not.toHaveBeenCalled();
        expect(keys[0]!.calls).toContain('title Confirm');
        expect(keys[1]!.calls).toContain('title Confirm');
    });

    it('disarms when the station stands down by some other hand', async () => {
        const station = fakeStation();
        const { transport, key } = await showing(station);
        await transport.press('stop');
        station.answer(stoodDown());
        await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
        expect(key.calls).not.toContain('ok');
        // The next press is now a Start, not the second half of a Stop.
        await transport.press('stop');
        expect(station.playout.stopPlayout).not.toHaveBeenCalled();
        expect(station.playout.startPlayout).toHaveBeenCalledTimes(1);
    });

    it('disarms when the station stops answering', async () => {
        const station = fakeStation();
        const { transport } = await showing(station);
        await transport.press('stop');
        station.playout.getPlayoutStatus.mockRejectedValueOnce(new TypeError('fetch failed'));
        await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
        station.playout.getPlayoutStatus.mockResolvedValue(await station.playout.getPlayoutStatus());
        await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
        await transport.press('stop');
        expect(station.playout.stopPlayout).not.toHaveBeenCalled();
    });

    it('starts a stood-down station at the first press', async () => {
        const station = fakeStation(stoodDown());
        const { transport, key } = await showing(station);
        await transport.press('stop');
        expect(station.playout.startPlayout).toHaveBeenCalledTimes(1);
        // Drawn as Stop from the answer the Start came back with, before the tick.
        expect(key.calls.slice(key.calls.indexOf(`state ${START}`))).toEqual(expect.arrayContaining([`state ${STOP}`, 'ok']));
    });

    it('says there is nothing to resume when the station refuses a Start', async () => {
        const station = fakeStation(stoodDown());
        station.nothingToResume();
        const { transport, key, log } = await showing(station);
        await transport.press('stop');
        expect(key.calls).toContain('alert');
        expect(log).toHaveBeenCalledWith(expect.stringMatching(/^Nothing to resume/));
    });

    it('refuses a press before there is any reading', async () => {
        const station = fakeStation();
        station.poller.reconfigure(undefined);
        const { transport, key } = await showing(station);
        await transport.press('stop');
        expect(key.calls).toContain('alert');
        expect(key.calls).toContain('title Set up');
    });
});
