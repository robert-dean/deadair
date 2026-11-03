// What a day is to this station: first match in the operator's order, read in the station's zone, with
// a window the claim machinery can hold a break to.

import { describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import type { Logger } from '@maroonedsoftware/logger';

import { toOccasion, type Occasion, type OccasionRepository } from '../../../src/modules/schedule/occasion.repository.js';
import { OccasionService } from '../../../src/modules/schedule/occasion.service.js';
import { settingsConfig } from '../../utils/settings.config.js';

const ZONE = 'America/New_York';
const local = (year: number, month: number, day: number, hour = 12) => DateTime.fromObject({ year, month, day, hour }, { zone: ZONE }).toMillis();

const halloween: Occasion = { id: 'a', words: 'Halloween', rule: { kind: 'fixed', month: 10, day: 31 }, enabled: true, position: 10 };

function service(enabled: () => Promise<Occasion[]>) {
    const warn = vi.fn();
    const occasions = { enabled } as unknown as OccasionRepository;
    const config = settingsConfig({ 'station.timezone': ZONE }).config;
    return { service: new OccasionService(occasions, config, { warn } as unknown as Logger), warn };
}

describe('OccasionService.on', () => {
    it('answers nothing on an ordinary day', async () => {
        const { service: occasions } = service(async () => [halloween]);
        expect(await occasions.on(local(2026, 11, 3))).toBeUndefined();
    });

    it('answers the words, and a window that is the station day', async () => {
        const { service: occasions } = service(async () => [halloween]);
        expect(await occasions.on(local(2026, 10, 31))).toEqual({
            words: 'Halloween',
            validFrom: local(2026, 10, 31, 0),
            validUntil: local(2026, 11, 1, 0),
        });
    });

    it('reads the date at the station rather than in UTC', async () => {
        const { service: occasions } = service(async () => [halloween]);
        // Half an hour into November in UTC, and still the evening of the 31st in Atlanta.
        const at = DateTime.utc(2026, 11, 1, 0, 30).toMillis();
        expect((await occasions.on(at))?.words).toBe('Halloween');
    });

    it('holds the window on a day the clocks change', async () => {
        const clocksBack: Occasion = { ...halloween, rule: { kind: 'fixed', month: 11, day: 1 } };
        const { service: occasions } = service(async () => [clocksBack]);
        const found = await occasions.on(local(2026, 11, 1));
        expect(found!.validUntil - found!.validFrom).toBe(25 * 3_600_000);
    });

    it('carries the mood when the occasion names one', async () => {
        const { service: occasions } = service(async () => [{ ...halloween, mood: 'fear' }]);
        expect((await occasions.on(local(2026, 10, 31)))?.mood).toBe('fear');
    });

    it('takes the first match, in the order it was handed', async () => {
        const spooky: Occasion = { ...halloween, id: 'b', words: 'Spooky Saturday', position: 20 };
        const { service: occasions } = service(async () => [halloween, spooky]);
        expect((await occasions.on(local(2026, 10, 31)))?.words).toBe('Halloween');
    });

    it('costs the occasion and never the caller when the table cannot be read', async () => {
        const { service: occasions, warn } = service(async () => {
            throw new Error('no database');
        });
        expect(await occasions.on(local(2026, 10, 31))).toBeUndefined();
        expect(warn).toHaveBeenCalledOnce();
    });
});

describe('toOccasion', () => {
    const row = {
        id: 'a',
        stationKey: 'main',
        words: 'Thanksgiving',
        enabled: false,
        position: 100,
        createdAt: DateTime.now(),
        updatedAt: DateTime.now(),
        month: null,
        day: null,
        ordinal: null,
        weekday: null,
        offsetDays: null,
        calendar: null,
        calendarMonth: null,
        dates: null,
        mood: null,
    };

    it('reads each kind of rule out of its own columns', () => {
        expect(toOccasion({ ...row, ruleKind: 'fixed', month: 10, day: 31 }).rule).toEqual({ kind: 'fixed', month: 10, day: 31 });
        expect(toOccasion({ ...row, ruleKind: 'weekday', month: 11, ordinal: 4, weekday: 4 }).rule).toEqual({
            kind: 'weekday',
            month: 11,
            ordinal: 4,
            weekday: 4,
        });
        expect(toOccasion({ ...row, ruleKind: 'easter', offsetDays: -2 }).rule).toEqual({ kind: 'easter', offsetDays: -2 });
        expect(toOccasion({ ...row, ruleKind: 'calendar', calendar: 'hebrew', calendarMonth: 'Tishri', day: 1 }).rule).toEqual({
            kind: 'calendar',
            calendar: 'hebrew',
            calendarMonth: 'Tishri',
            day: 1,
        });
        expect(toOccasion({ ...row, ruleKind: 'dates', dates: ['2026-11-08'] }).rule).toEqual({ kind: 'dates', dates: ['2026-11-08'] });
    });

    it('drops an absent mood rather than passing it through', () => {
        expect(toOccasion({ ...row, ruleKind: 'easter', offsetDays: 0 })).not.toHaveProperty('mood');
        expect(toOccasion({ ...row, ruleKind: 'easter', offsetDays: 0, mood: 'love' }).mood).toBe('love');
    });
});
