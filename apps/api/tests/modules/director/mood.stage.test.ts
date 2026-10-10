// Which stage of a slot's moods a refill leans into. The stages are equal shares of the slot in order,
// measured from now (when the slot is known to be in force) plus how far ahead the batch will mostly air.

import { describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';

import { refillMood, stageAt } from '../../../src/modules/director/mood.stage.js';
import type { ScheduleSlot } from '../../../src/modules/director/schedule.js';
import { NOMINAL_TRACK_MS } from '../../../src/modules/director/air.estimate.js';
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
/** Ten at night to two in the morning, across midnight. */
const late: ScheduleSlot = {
    id: 'late',
    label: 'Late',
    startsAtMinutes: 22 * 60,
    endsAtMinutes: 2 * 60,
    days: [],
    mode: 'rotation',
    onEnd: 'extend',
};

const at = (hour: number, minute = 0) => DateTime.fromObject({ year: 2026, month: 10, day: 10, hour, minute }, { zone: ZONE }).toMillis();

describe('stageAt', () => {
    it('leans into each stage for its equal share of the slot, in order', () => {
        const moods = ['comfort', 'loneliness'] as const;

        expect(stageAt(moods, evening, at(20, 10), 0, ZONE)).toBe('comfort');
        expect(stageAt(moods, evening, at(21, 50), 0, ZONE)).toBe('comfort');
        expect(stageAt(moods, evening, at(22, 0), 0, ZONE)).toBe('loneliness');
        expect(stageAt(moods, evening, at(23, 30), 0, ZONE)).toBe('loneliness');
    });

    it('measures where the batch will air, not where the station is now', () => {
        // Half past nine with the batch mostly airing an hour on is the second half of the evening.
        expect(stageAt(['comfort', 'loneliness'], evening, at(21, 30), HOUR, ZONE)).toBe('loneliness');
    });

    it('reads a batch that will air past the changeover as the last stage', () => {
        expect(stageAt(['love', 'comfort', 'sadness'], evening, at(23, 30), 3 * HOUR, ZONE)).toBe('sadness');
    });

    it('counts a slot across midnight from its own start', () => {
        expect(stageAt(['happiness', 'loneliness'], late, at(23, 30), 0, ZONE)).toBe('happiness');
        expect(
            stageAt(
                ['happiness', 'loneliness'],
                late,
                DateTime.fromObject({ year: 2026, month: 10, day: 11, hour: 0, minute: 30 }, { zone: ZONE }).toMillis(),
                0,
                ZONE,
            ),
        ).toBe('loneliness');
    });

    it('is the one stage, or the first with no slot to measure against, or nothing for no lean', () => {
        expect(stageAt(['comfort'], evening, at(23, 0), 0, ZONE)).toBe('comfort');
        expect(stageAt(['comfort', 'sadness'], undefined, at(23, 0), 0, ZONE)).toBe('comfort');
        expect(stageAt(undefined, evening, at(23, 0), 0, ZONE)).toBeUndefined();
        expect(stageAt([], evening, at(23, 0), 0, ZONE)).toBeUndefined();
    });
});

describe('refillMood', () => {
    const config = settingsConfig({ 'station.timezone': ZONE }).config;
    const schedule = (slot?: ScheduleSlot) => ({ inForce: vi.fn(async () => slot) });

    it('measures the stage against the slot the broadcast was put on for', async () => {
        const moods = await refillMood({ moods: ['comfort', 'loneliness'], slotId: 'evening' }, [], 4, schedule(evening), config, at(21, 30));

        // Half past nine, and a four-record batch mostly airs nine minutes on: still the first half.
        expect((4 * NOMINAL_TRACK_MS) / 2).toBeLessThan(HOUR / 2);
        expect(moods).toBe('comfort');
    });

    it('leans into the first stage for a broadcast that is not the slot in force, or with no slot at all', async () => {
        expect(await refillMood({ moods: ['comfort', 'loneliness'], slotId: 'evening' }, [], 4, schedule(late), config, at(23, 30))).toBe('comfort');
        expect(await refillMood({ moods: ['comfort', 'loneliness'] }, [], 4, schedule(evening), config, at(23, 30))).toBe('comfort');
    });

    it('reads no schedule for a single stage, and leans into nothing for no stages', async () => {
        const read = schedule(evening);

        expect(await refillMood({ moods: ['sadness'], slotId: 'evening' }, [], 4, read, config, at(23, 30))).toBe('sadness');
        expect(await refillMood({ slotId: 'evening' }, [], 4, read, config, at(23, 30))).toBeUndefined();
        expect(read.inForce).not.toHaveBeenCalled();
    });

    it('costs the stage and never the refill when the schedule cannot be read', async () => {
        const broken = { inForce: vi.fn(async () => Promise.reject(new Error('the schedule is gone'))) };

        expect(await refillMood({ moods: ['comfort', 'loneliness'], slotId: 'evening' }, [], 4, broken, config, at(23, 30))).toBe('comfort');
    });
});
