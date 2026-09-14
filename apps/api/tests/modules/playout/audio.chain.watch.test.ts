// The judgement is tested on its own; this is the wiring around it. What matters is that the facts
// come from where the transport leaves them, that a verdict writes the request and one line in the
// feed and nothing else, and that the operator's switch is read as the string a setting is.

import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Logger } from '@maroonedsoftware/logger';

import { AudioChainWatch } from '../../../src/modules/playout/audio.chain.watch.js';
import { RESTART_ATTEMPTS, RESTART_COOLDOWN_MS, RESTART_STUCK_CHAIN_KEY, STUCK_AFTER_MS } from '../../../src/modules/playout/audio.chain.watchdog.js';
import type { QueueStatus, PlayoutControlClient } from '../../../src/modules/playout/liquidsoap.control.js';
import type { PlayoutPusher } from '../../../src/modules/playout/playout.pusher.js';
import type { ActivityRecorder } from '../../../src/modules/activity/activity.recorder.js';
import type { StationEvent } from '../../../src/modules/activity/station.events.repository.js';
import type { AudioChainRestart } from '../../../src/modules/stream/stream.restart.js';

const NOW = 50_000_000;

interface Chain {
    downSince?: number;
    starvedSince?: number;
    reading?: QueueStatus;
    wantsAir?: boolean;
    setting?: string;
    written?: boolean;
}

function watchOver(chain: Chain) {
    const control = {
        downSince: () => chain.downSince,
        starvedSince: () => chain.starvedSince,
        lastReading: () => chain.reading,
    } as unknown as PlayoutControlClient;
    const pusher = { wantsAir: () => chain.wantsAir ?? true } as unknown as PlayoutPusher;
    const request = vi.fn(() => chain.written ?? true);
    const record = vi.fn(async (_event: StationEvent) => undefined);
    // A setting is a string at every layer, so the double answers one, and only for the key asked.
    const config = {
        get: vi.fn((key: string, fallback: unknown) => (key === RESTART_STUCK_CHAIN_KEY && chain.setting !== undefined ? chain.setting : fallback)),
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

    const watch = new AudioChainWatch(
        control,
        pusher,
        { request } as unknown as AudioChainRestart,
        { record } as unknown as ActivityRecorder,
        config as unknown as AppConfig,
        logger,
    );
    return { watch, request, record, logger };
}

/** The 2026-09-13 state: the lease held, a record handed over and held, and the bed on the mount. */
const stuck = (over: Chain = {}): Chain => ({ starvedSince: NOW - STUCK_AFTER_MS, reading: { queued: 1, ready: false }, ...over });

describe('AudioChainWatch', () => {
    it('asks for a restart and says so once in the feed when the chain holds a record without playing it', () => {
        const { watch, request, record } = watchOver(stuck());

        expect(watch.check(NOW)).toMatchObject({ action: 'restart', reason: 'holdingNotPlaying' });
        expect(request).toHaveBeenCalledWith('holdingNotPlaying');
        expect(record).toHaveBeenCalledTimes(1);
        expect(record).toHaveBeenCalledWith(
            expect.objectContaining({
                module: 'playout',
                kind: 'chain.restart',
                severity: 'fault',
                detail: 'The audio chain has held a record for 60s without playing it, so the station asked for it to be restarted.',
            }),
        );
    });

    it('does nothing at all about a chain that is playing', () => {
        const { watch, request, record } = watchOver({ reading: { queued: 1, ready: true } });

        expect(watch.check(NOW)).toEqual({ action: 'none' });
        expect(request).not.toHaveBeenCalled();
        expect(record).not.toHaveBeenCalled();
    });

    it('judges a starve only while the transport wants the mount', () => {
        const { watch, request } = watchOver(stuck({ wantsAir: false }));

        expect(watch.check(NOW)).toEqual({ action: 'none' });
        expect(request).not.toHaveBeenCalled();
    });

    it('reads its switch as the string a setting is', () => {
        // `config.get(key, false)` would answer 'false', which is truthy. The switch has to be off.
        const { watch, request } = watchOver(stuck({ setting: 'false' }));

        expect(watch.check(NOW)).toEqual({ action: 'none' });
        expect(request).not.toHaveBeenCalled();
    });

    it('asks for a chain that has stopped answering, from the control client clock', () => {
        const { watch, request } = watchOver({ downSince: NOW - 60_000, wantsAir: false });

        expect(watch.check(NOW)).toMatchObject({ action: 'restart', reason: 'notAnswering' });
        expect(request).toHaveBeenCalledWith('notAnswering');
    });

    it('still reports a request it could not write, and says it needs a hand', () => {
        const { watch, record } = watchOver(stuck({ written: false }));

        watch.check(NOW);

        expect(record).toHaveBeenCalledWith(
            expect.objectContaining({ detail: expect.stringContaining('The request could not be written, so it has to be restarted by hand.') }),
        );
    });

    it('remembers across checks, so the bounds hold: once per cooldown, then one give-up', () => {
        const { watch, request, record } = watchOver(stuck());

        for (let attempt = 0; attempt < RESTART_ATTEMPTS; attempt++) watch.check(NOW + attempt * RESTART_COOLDOWN_MS);
        watch.check(NOW + RESTART_ATTEMPTS * RESTART_COOLDOWN_MS - 1);
        watch.check(NOW + RESTART_ATTEMPTS * RESTART_COOLDOWN_MS);
        watch.check(NOW + (RESTART_ATTEMPTS + 5) * RESTART_COOLDOWN_MS);

        expect(request).toHaveBeenCalledTimes(RESTART_ATTEMPTS);
        expect(record.mock.calls.map(([event]) => event.kind)).toEqual([...Array<string>(RESTART_ATTEMPTS).fill('chain.restart'), 'chain.gaveUp']);
    });
});
