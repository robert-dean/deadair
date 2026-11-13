import { describe, expect, it, vi } from 'vitest';

import { BedPicker, chooseBed } from '../../../src/modules/render/bed.choice.js';
import type { ShelvedSegment } from '../../../src/modules/render/segment.repository.js';

const bed = (id: string, forShow = false): ShelvedSegment =>
    ({ id, kind: 'bed', state: 'ready', label: id, source: 'library', pads: [], forShow }) as unknown as ShelvedSegment;

describe('chooseBed', () => {
    it('answers nothing for a show with no beds at all, which is a break with no bed', () => {
        expect(chooseBed([], undefined)).toBeUndefined();
    });

    it("takes the show's own beds over the station's", () => {
        for (let i = 0; i < 20; i++) {
            expect(chooseBed([bed('station'), bed('mine', true)], undefined)).toBe('mine');
        }
    });

    it("falls back to the station's beds for a show that has none of its own", () => {
        expect(chooseBed([bed('station')], undefined)).toBe('station');
    });

    it('avoids the bed the last break had where there is another', () => {
        for (let i = 0; i < 20; i++) {
            expect(chooseBed([bed('a', true), bed('b', true)], 'a')).toBe('b');
        }
    });

    it('plays the one bed a show has every time, which is what its operator chose', () => {
        expect(chooseBed([bed('only', true)], 'only')).toBe('only');
    });

    it('picks among the pool with the random it is handed', () => {
        expect(chooseBed([bed('a'), bed('b'), bed('c')], undefined, () => 0.99)).toBe('c');
    });
});

describe('BedPicker', () => {
    it('reads the beds once, the first time a break wants one, and deals them out without repeating', async () => {
        const listBeds = vi.fn(async () => [bed('a', true), bed('b', true)]);
        const picker = new BedPicker({ listBeds }, { slotId: 'slot-1' });

        const first = await picker.next();
        const second = await picker.next();

        expect(listBeds).toHaveBeenCalledTimes(1);
        expect(listBeds).toHaveBeenCalledWith({ slotId: 'slot-1' });
        expect(first).not.toBe(second);
    });

    it('answers no bed, and says why once, when the beds cannot be read', async () => {
        const onError = vi.fn();
        const picker = new BedPicker(
            {
                listBeds: () => {
                    throw new Error('away');
                },
            },
            {},
            onError,
        );

        expect(await picker.next()).toBeUndefined();
        expect(await picker.next()).toBeUndefined();
        expect(onError).toHaveBeenCalledTimes(1);
    });
});
