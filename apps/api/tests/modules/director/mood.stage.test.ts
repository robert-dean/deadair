// Which stage of a slot's moods a refill leans into. The stages are equal shares of the slot in order,
// measured from now (when the slot is known to be in force) plus how far ahead the batch will mostly air.

import { describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';

import { refillMood, stageAt, stretchMood } from '../../../src/modules/director/mood.stage.js';
import type { ScheduleSlot } from '../../../src/modules/director/schedule.js';
import { NOMINAL_TRACK_MS } from '../../../src/modules/director/air.estimate.js';
import type { LyricMood } from '../../../src/modules/lyrics/lyric.moods.js';
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

const noOccasion = { on: vi.fn(async () => undefined) };

describe('refillMood', () => {
    const config = settingsConfig({ 'station.timezone': ZONE }).config;
    const schedule = (slot?: ScheduleSlot) => ({ inForce: vi.fn(async () => slot) });

    it('measures the stage against the slot the broadcast was put on for', async () => {
        const moods = await refillMood(
            { moods: ['comfort', 'loneliness'], slotId: 'evening' },
            [],
            4,
            schedule(evening),
            noOccasion,
            config,
            at(21, 30),
        );

        // Half past nine, and a four-record batch mostly airs nine minutes on: still the first half.
        expect((4 * NOMINAL_TRACK_MS) / 2).toBeLessThan(HOUR / 2);
        expect(moods).toBe('comfort');
    });

    it('leans into the first stage for a broadcast that is not the slot in force, or with no slot at all', async () => {
        expect(await refillMood({ moods: ['comfort', 'loneliness'], slotId: 'evening' }, [], 4, schedule(late), noOccasion, config, at(23, 30))).toBe(
            'comfort',
        );
        expect(await refillMood({ moods: ['comfort', 'loneliness'] }, [], 4, schedule(evening), noOccasion, config, at(23, 30))).toBe('comfort');
    });

    it('reads no schedule for a single stage, and leans into nothing for no stages', async () => {
        const read = schedule(evening);

        expect(await refillMood({ moods: ['sadness'], slotId: 'evening' }, [], 4, read, noOccasion, config, at(23, 30))).toBe('sadness');
        expect(await refillMood({ slotId: 'evening' }, [], 4, read, noOccasion, config, at(23, 30))).toBeUndefined();
        expect(read.inForce).not.toHaveBeenCalled();
    });

    it('costs the stage and never the refill when the schedule cannot be read', async () => {
        const broken = { inForce: vi.fn(async () => Promise.reject(new Error('the schedule is gone'))) };

        expect(await refillMood({ moods: ['comfort', 'loneliness'], slotId: 'evening' }, [], 4, broken, noOccasion, config, at(23, 30))).toBe(
            'comfort',
        );
    });
});

describe('stretchMood', () => {
    const config = settingsConfig({ 'station.timezone': ZONE }).config;
    const schedule = (slot?: ScheduleSlot) => ({ inForce: vi.fn(async () => slot) });

    it('answers the stage the moment lands in, measured ahead from now', async () => {
        // Half past nine in an eight-to-midnight slot with two stages: the second stage starts at ten.
        expect(await stretchMood({ moods: ['comfort', 'loneliness'], slotId: 'evening' }, 0, schedule(evening), noOccasion, config, at(21, 30))).toBe(
            'comfort',
        );
        expect(
            await stretchMood({ moods: ['comfort', 'loneliness'], slotId: 'evening' }, HOUR, schedule(evening), noOccasion, config, at(21, 30)),
        ).toBe('loneliness');
    });

    it('agrees with the draw: a refill is the same reading at its own midpoint', async () => {
        const lineup = { moods: ['comfort', 'loneliness'] as const, slotId: 'evening' };
        const now = at(21, 55);

        expect(await refillMood(lineup, [], 4, schedule(evening), noOccasion, config, now)).toBe(
            await stretchMood(lineup, (4 * NOMINAL_TRACK_MS) / 2, schedule(evening), noOccasion, config, now),
        );
    });
});

describe('the mood of an occasion', () => {
    const config = settingsConfig({ 'station.timezone': ZONE }).config;
    const schedule = { inForce: vi.fn(async () => undefined) };
    const today = (mood?: LyricMood) => ({
        on: vi.fn(async () => ({ words: 'Halloween', validFrom: 0, validUntil: 1, ...(mood === undefined ? {} : { mood }) })),
    });

    it('leans a broadcast with no stages', async () => {
        expect(await stretchMood({ slotId: 'evening' }, 0, schedule, today('fear'), config, at(21, 0))).toBe('fear');
        expect(await stretchMood({ moods: [] }, 0, schedule, today('fear'), config, at(21, 0))).toBe('fear');
    });

    it('never leans over stages the broadcast names, and does not even ask', async () => {
        const occasions = today('fear');
        expect(await stretchMood({ moods: ['comfort'] }, 0, schedule, occasions, config, at(21, 0))).toBe('comfort');
        expect(occasions.on).not.toHaveBeenCalled();
    });

    it('leans into nothing when the day names no mood, or on an ordinary day', async () => {
        expect(await stretchMood({}, 0, schedule, today(), config, at(21, 0))).toBeUndefined();
        expect(await stretchMood({}, 0, schedule, noOccasion, config, at(21, 0))).toBeUndefined();
    });

    it('never leans into a mood the broadcast steers away from', async () => {
        expect(await stretchMood({ avoidMoods: ['fear'] }, 0, schedule, today('fear'), config, at(21, 0))).toBeUndefined();
        expect(await stretchMood({ avoidMoods: ['sadness'] }, 0, schedule, today('fear'), config, at(21, 0))).toBe('fear');
    });

    it('asks about the instant the stretch airs, so a batch that will air after midnight leans into tomorrow', async () => {
        const occasions = today('love');
        const now = at(23, 50);

        await stretchMood({}, HOUR, schedule, occasions, config, now);

        expect(occasions.on).toHaveBeenCalledWith(now + HOUR);
    });

    it('measures a refill from where most of its batch will air', async () => {
        const occasions = today('love');
        const now = at(23, 50);

        await refillMood({}, [], 4, schedule, occasions, config, now);

        expect(occasions.on).toHaveBeenCalledWith(now + (4 * NOMINAL_TRACK_MS) / 2);
    });
});
