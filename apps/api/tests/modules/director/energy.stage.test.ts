import { describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';

import { NOMINAL_TRACK_MS } from '../../../src/modules/director/air.estimate.js';
import { MAX_ENERGY_STAGES, energyStages, energyStagesField, refillEnergy, stretchEnergy } from '../../../src/modules/director/energy.stage.js';
import type { ScheduleSlot } from '../../../src/modules/director/schedule.js';
import { settingsConfig } from '../../utils/settings.config.js';

const ZONE = 'UTC';
const HOUR = 60 * 60_000;
/** Eight in the evening to midnight, every day. */
const evening: ScheduleSlot = {
    id: 'evening',
    label: 'Evening',
    startsAtMinutes: 20 * 60,
    endsAtMinutes: 24 * 60,
    days: [],
    mode: 'rotation',
    onEnd: 'extend',
};
const at = (hour: number, minute = 0) => DateTime.fromObject({ year: 2026, month: 10, day: 10, hour, minute }, { zone: ZONE }).toMillis();
const config = settingsConfig({ 'station.timezone': ZONE }).config;
const inForce = (slot: ScheduleSlot | undefined) => ({ inForce: vi.fn(async () => slot) });
const building = { rules: { energyStages: ['low', 'medium', 'high', 'high'] as const }, slotId: 'evening' };

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

describe('stretchEnergy', () => {
    it('builds through the slot as its stages say, an equal share each', async () => {
        // Four stages over four hours: an hour each.
        expect(await stretchEnergy(building, 0, inForce(evening), config, at(20, 30))).toBe('low');
        expect(await stretchEnergy(building, 0, inForce(evening), config, at(21, 30))).toBe('medium');
        expect(await stretchEnergy(building, HOUR, inForce(evening), config, at(21, 30))).toBe('high');
    });

    it('leans to the first stage for a broadcast started outside its slot, or one the slot has moved on from', async () => {
        expect(await stretchEnergy({ rules: building.rules }, 0, inForce(evening), config, at(23, 0))).toBe('low');
        expect(await stretchEnergy(building, 0, inForce({ ...evening, id: 'later' }), config, at(23, 0))).toBe('low');
    });

    it('costs the stage and never the caller when the schedule cannot be read', async () => {
        const failing = { inForce: vi.fn(async () => Promise.reject(new Error('the schedule is gone'))) };

        expect(await stretchEnergy(building, 0, failing, config, at(23, 0))).toBe('low');
    });

    it('leans nowhere for a broadcast with no stages, and does not ask the schedule', async () => {
        const schedule = inForce(evening);

        expect(await stretchEnergy({ rules: {} }, 0, schedule, config, at(21, 0))).toBeUndefined();
        expect(await stretchEnergy({ rules: { energyStages: [] } }, 0, schedule, config, at(21, 0))).toBeUndefined();
        expect(schedule.inForce).not.toHaveBeenCalled();
    });

    it('agrees with the draw: a refill is the same reading at its own midpoint', async () => {
        const now = at(21, 55);

        expect(await refillEnergy(building, [], 4, inForce(evening), config, now)).toBe(
            await stretchEnergy(building, (4 * NOMINAL_TRACK_MS) / 2, inForce(evening), config, now),
        );
    });
});
