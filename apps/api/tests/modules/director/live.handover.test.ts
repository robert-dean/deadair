// Between the live input's edges in playout and the director. What the director does about them is
// tested where it is decided; what is tested here is that the right edge asks for the right thing,
// that the setting is read as the string it is, and that a failure cannot take the bus down with it.

import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Logger } from '@maroonedsoftware/logger';

import { StationBus } from '../../../src/modules/shared/station.bus.js';
import { LiveHandOver } from '../../../src/modules/director/live.handover.js';
import type { DirectorService } from '../../../src/modules/director/director.service.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

function build(options: { setting?: string; handBackThrows?: boolean } = {}) {
    const bus = new StationBus(logger);
    const director = {
        liveTookTheAir: vi.fn(),
        liveHandedBack: vi.fn(async () => {
            if (options.handBackThrows) throw new Error('the mailbox is gone');
            return { resumed: true };
        }),
    } as unknown as DirectorService;
    // A setting is a string, so the stored value is handed back as one, defaults included.
    const config = { get: vi.fn((_key: string, fallback: string) => options.setting ?? fallback) } as unknown as AppConfig;
    const handOver = new LiveHandOver(bus, director, config, logger);
    handOver.start();

    return { bus, director };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

describe('LiveHandOver', () => {
    it('stands the station down when a presenter takes the air, by default', () => {
        const { bus, director } = build();

        bus.publish('live.changed', { state: 'onair', previous: 'preroll', at: 1 });

        expect(director.liveTookTheAir).toHaveBeenCalledTimes(1);
    });

    it('leaves the programme running when the operator chose to carry on', () => {
        const { bus, director } = build({ setting: 'continue' });

        bus.publish('live.changed', { state: 'onair', previous: 'preroll', at: 1 });

        expect(director.liveTookTheAir).not.toHaveBeenCalled();
    });

    it('takes a mistyped setting as the default rather than doing nothing', () => {
        const { bus, director } = build({ setting: 'standdown' });

        bus.publish('live.changed', { state: 'onair', previous: 'preroll', at: 1 });

        expect(director.liveTookTheAir).toHaveBeenCalledTimes(1);
    });

    it('asks for the station back on the hand-back, whatever the setting, and on nothing else', () => {
        const { bus, director } = build({ setting: 'continue' });

        bus.publish('live.changed', { state: 'armed', previous: 'off', at: 1 });
        bus.publish('live.changed', { state: 'preroll', previous: 'armed', at: 2 });
        bus.publish('live.changed', { state: 'off', previous: 'armed', at: 3 });
        expect(director.liveHandedBack).not.toHaveBeenCalled();

        bus.publish('live.changed', { state: 'off', previous: 'onair', at: 4 });
        expect(director.liveHandedBack).toHaveBeenCalledTimes(1);
    });

    it('says so when the hand-back fails, rather than throwing into the bus', async () => {
        const { bus } = build({ handBackThrows: true });

        bus.publish('live.changed', { state: 'off', previous: 'onair', at: 1 });
        await settle();

        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('could not go on again after a live show (the mailbox is gone)'));
    });
});
