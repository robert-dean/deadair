import { describe, expect, it } from 'vitest';

import { drawOf, rotationOf } from '../../../src/modules/shared/rotation.js';

describe('drawOf', () => {
    const ids = Array.from({ length: 5000 }, (_, index) => `segment-${index}`);

    it('answers a number in [0, 1), the same one every time for one id', () => {
        for (const id of ids.slice(0, 100)) {
            expect(drawOf(id)).toBeGreaterThanOrEqual(0);
            expect(drawOf(id)).toBeLessThan(1);
            expect(drawOf(id)).toBe(drawOf(id));
        }
    });

    it('spreads evenly, so a draw under a tenth comes up about a tenth of the time', () => {
        const rate = ids.filter(id => drawOf(id) < 0.1).length / ids.length;

        expect(rate).toBeGreaterThan(0.08);
        expect(rate).toBeLessThan(0.12);
    });

    // The reason it exists beside `rotationOf`: that hash is linear, so two salted copies of one id
    // answer numbers a constant apart and two draws meant to be independent move in step.
    it('gives two salts of one id independent draws, where the rotation hash does not', () => {
        const both = (draw: (id: string) => boolean) => ids.filter(id => draw(`${id}:a`) && draw(`${id}:b`)).length / ids.length;

        expect(both(id => drawOf(id) < 0.5)).toBeGreaterThan(0.2);
        expect(both(id => drawOf(id) < 0.5)).toBeLessThan(0.3);
        expect(both(id => rotationOf(id) % 2 === 0)).not.toBeCloseTo(0.25, 1);
    });
});
