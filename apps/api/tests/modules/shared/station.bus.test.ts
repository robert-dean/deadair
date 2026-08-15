// The one property that matters here: publishing cannot hurt the publisher. Every producer on this
// bus is a timer loop or a transport callback with nobody to hand a rejection to, so a subscriber
// that throws must cost its own reaction and nothing else.

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';

import { StationBus } from '../../../src/modules/shared/station.bus.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

describe('StationBus', () => {
    it('hands every subscriber the event', () => {
        const bus = new StationBus(logger);
        const seen: number[] = [];
        bus.subscribe('audience.arrived', event => seen.push(event.count));
        bus.subscribe('audience.arrived', event => seen.push(event.count * 10));

        bus.publish('audience.arrived', { count: 2 });

        expect(seen).toEqual([2, 20]);
    });

    it('publishes to nobody without complaint', () => {
        // The ordinary state for every event this grows before something wants it.
        const bus = new StationBus(logger);

        expect(() => bus.publish('audience.arrived', { count: 1 })).not.toThrow();
    });

    it('lets the others hear it when one subscriber throws', () => {
        const bus = new StationBus(logger);
        const seen: number[] = [];
        bus.subscribe('audience.arrived', () => {
            throw new Error('the director is gone');
        });
        bus.subscribe('audience.arrived', event => seen.push(event.count));

        expect(() => bus.publish('audience.arrived', { count: 1 })).not.toThrow();
        expect(seen).toEqual([1]);
        expect(logger.warn).toHaveBeenCalled();
    });

    it('stops telling a subscriber that has unsubscribed', () => {
        const bus = new StationBus(logger);
        const seen: number[] = [];
        const stop = bus.subscribe('audience.arrived', event => seen.push(event.count));

        bus.publish('audience.arrived', { count: 1 });
        stop();
        bus.publish('audience.arrived', { count: 2 });

        expect(seen).toEqual([1]);
    });
});
