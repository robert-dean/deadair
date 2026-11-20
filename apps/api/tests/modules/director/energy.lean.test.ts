import { describe, expect, it } from 'vitest';

import type { Energy } from '../../../src/modules/analysis/energy.rank.js';
import { inEnergyStage } from '../../../src/modules/director/energy.lean.js';

const pool = (percentiles: number[]) =>
    new Map(percentiles.map((percentile, index): [string, Energy] => [`r${index}`, { percentile, from: 'loudness' }]));

describe('inEnergyStage', () => {
    it("takes the stage's third of the pool, however low the pool sits in the library", () => {
        const energies = pool([2, 4, 6, 8, 10, 12]);

        expect([...inEnergyStage(energies, 'high')].sort()).toEqual(['r4', 'r5']);
        expect([...inEnergyStage(energies, 'low')].sort()).toEqual(['r0', 'r1']);
        expect([...inEnergyStage(energies, 'medium')].sort()).toEqual(['r2', 'r3']);
    });

    it('leans nowhere with no stage, or with a pool too small to split', () => {
        expect(inEnergyStage(pool([2, 4, 6, 8, 10, 12]), undefined).size).toBe(0);
        expect(inEnergyStage(pool([2, 4, 6, 8, 10]), 'high').size).toBe(0);
    });
});
