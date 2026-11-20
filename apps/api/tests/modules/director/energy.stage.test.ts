import { describe, expect, it } from 'vitest';

import { MAX_ENERGY_STAGES, energyStages, energyStagesField } from '../../../src/modules/director/energy.stage.js';

describe('energyStages', () => {
    it('keeps the known levels in order, repeats included', () => {
        expect(energyStages(['low', 'low', 'high'])).toEqual(['low', 'low', 'high']);
    });

    it('drops what it does not know and keeps no more than the most a slot may hold', () => {
        expect(energyStages(['low', 'loud', 7, 'medium'])).toEqual(['low', 'medium']);
        expect(energyStages(['low', 'medium', 'high', 'medium', 'low'])).toHaveLength(MAX_ENERGY_STAGES);
    });

    it('answers nothing, never an empty list, for no lean', () => {
        expect(energyStages([])).toBeUndefined();
        expect(energyStages(null)).toBeUndefined();
        expect(energyStages(undefined)).toBeUndefined();
        expect(energyStagesField([])).toEqual({});
        expect(energyStagesField(['high'])).toEqual({ energyStages: ['high'] });
    });
});
