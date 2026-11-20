import { describe, expect, it } from 'vitest';

import { RefillEnergy } from '../../../src/modules/shared/refill.energy.js';

describe('RefillEnergy', () => {
    it('reads nothing and names no stage until a refill sets one, which is every break writer', async () => {
        const energy = new RefillEnergy();

        expect(energy.stage).toBeUndefined();
        expect((await energy.bandsFor(['t1'])).size).toBe(0);
    });

    it("answers the refill's bands, and none at all when they cannot be read", async () => {
        const working = new RefillEnergy();
        working.set('high', async ids => new Map(ids.map(id => [id, 'medium' as const])));
        const failing = new RefillEnergy();
        failing.set('high', async () => Promise.reject(new Error('the analysis table is gone')));

        expect(Object.fromEntries(await working.bandsFor(['t1']))).toEqual({ t1: 'medium' });
        expect((await failing.bandsFor(['t1'])).size).toBe(0);
    });
});
