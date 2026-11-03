// A rule as it arrives from the console or somebody's file, and when one next falls. The refusals are
// for rules the table would store happily and the station could never act on, which fail in silence.

import { describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import type { Logger } from '@maroonedsoftware/logger';

import { stationDateOf } from '../../../src/modules/director/schedule.js';
import type { Occasion, OccasionRepository } from '../../../src/modules/schedule/occasion.repository.js';
import { calendarMonths, nextOccasionDate, occasionRuleOf } from '../../../src/modules/schedule/occasion.rule.js';
import { OccasionService } from '../../../src/modules/schedule/occasion.service.js';
import { settingsConfig } from '../../utils/settings.config.js';

describe('occasionRuleOf', () => {
    it('reads each kind from its own fields, ignoring the rest', () => {
        expect(occasionRuleOf({ ruleKind: 'fixed', month: 10, day: 31, offsetDays: 3 })).toEqual({ kind: 'fixed', month: 10, day: 31 });
        expect(occasionRuleOf({ ruleKind: 'weekday', month: 11, ordinal: 4, weekday: 4 })).toEqual({
            kind: 'weekday',
            month: 11,
            ordinal: 4,
            weekday: 4,
        });
        expect(occasionRuleOf({ ruleKind: 'easter', offsetDays: -2 })).toEqual({ kind: 'easter', offsetDays: -2 });
        expect(occasionRuleOf({ ruleKind: 'calendar', calendar: 'hebrew', calendarMonth: 'Tishri', day: 1 })).toEqual({
            kind: 'calendar',
            calendar: 'hebrew',
            calendarMonth: 'Tishri',
            day: 1,
        });
    });

    it('sorts a list of dates and drops the repeats', () => {
        expect(occasionRuleOf({ ruleKind: 'dates', dates: ['2027-10-29', '2026-11-08', '2027-10-29'] })).toEqual({
            kind: 'dates',
            dates: ['2026-11-08', '2027-10-29'],
        });
    });

    it.each([
        ['a fixed date with no day', { ruleKind: 'fixed', month: 6 }],
        ['a date that does not exist', { ruleKind: 'fixed', month: 6, day: 31 }],
        ['a weekday with no weekday', { ruleKind: 'weekday', month: 11, ordinal: 4 }],
        ['a zeroth weekday', { ruleKind: 'weekday', month: 11, ordinal: 0, weekday: 4 }],
        ['a day around Easter with no offset', { ruleKind: 'easter' }],
        ['a month that calendar does not have', { ruleKind: 'calendar', calendar: 'hebrew', calendarMonth: 'Shawwal', day: 1 }],
        ['a day no month in that calendar has', { ruleKind: 'calendar', calendar: 'hebrew', calendarMonth: 'Tishri', day: 31 }],
        ['an empty list of dates', { ruleKind: 'dates', dates: [] }],
        ['a date that is not one', { ruleKind: 'dates', dates: ['2026-02-30'] }],
    ] as const)('answers a sentence for %s', (_name, fields) => {
        expect(typeof occasionRuleOf(fields)).toBe('string');
    });

    it('still allows the 29th of February', () => {
        expect(occasionRuleOf({ ruleKind: 'fixed', month: 2, day: 29 })).toEqual({ kind: 'fixed', month: 2, day: 29 });
    });
});

describe('calendarMonths', () => {
    it('lists the months each calendar names, the Hebrew leap month among them', () => {
        expect(calendarMonths('hebrew')).toEqual(expect.arrayContaining(['Tishri', 'Kislev', 'Adar', 'Adar I', 'Adar II']));
        expect(calendarMonths('hebrew')).toHaveLength(14);
        expect(calendarMonths('islamic-umalqura')).toEqual(expect.arrayContaining(['Shawwal', 'Dhuʻl-Hijjah']));
        expect(calendarMonths('islamic-umalqura')).toHaveLength(12);
    });
});

describe('nextOccasionDate', () => {
    const from = stationDateOf('2026-11-03')!;

    it('counts today', () => {
        expect(nextOccasionDate({ kind: 'fixed', month: 11, day: 3 }, from)).toMatchObject({ year: 2026, month: 11, day: 3 });
    });

    it('rolls into next year once this one has passed', () => {
        expect(nextOccasionDate({ kind: 'fixed', month: 10, day: 31 }, from)).toMatchObject({ year: 2027, month: 10, day: 31 });
    });

    it('finds the next leap day', () => {
        expect(nextOccasionDate({ kind: 'fixed', month: 2, day: 29 }, from)).toMatchObject({ year: 2028, month: 2, day: 29 });
    });

    it('finds the next date on a list, and nothing once it has run out', () => {
        expect(nextOccasionDate({ kind: 'dates', dates: ['2026-11-08', '2027-10-29'] }, from)).toMatchObject({ year: 2026, month: 11, day: 8 });
        expect(nextOccasionDate({ kind: 'dates', dates: ['2025-11-08'] }, from)).toBeUndefined();
    });
});

describe('the console door', () => {
    const halloween: Occasion = { id: 'a', words: 'Halloween', rule: { kind: 'fixed', month: 10, day: 31 }, enabled: true, position: 10 };

    function build(rows: Occasion[] = [halloween]) {
        const repository = {
            list: vi.fn(async () => rows),
            add: vi.fn(async () => rows[0]),
            change: vi.fn(async (): Promise<Occasion | undefined> => rows[0]),
            remove: vi.fn(async () => true),
            reorder: vi.fn(async () => undefined),
        };
        const service = new OccasionService(repository as unknown as OccasionRepository, settingsConfig().config, {} as unknown as Logger);
        return { repository, service };
    }

    it('answers the rule side by side with when it next falls', async () => {
        const { service } = build();
        const { occasions, calendars } = await service.list();
        const nextHalloween = DateTime.now().toFormat('yyyy');

        expect(occasions[0]).toMatchObject({ id: 'a', words: 'Halloween', ruleKind: 'fixed', month: 10, day: 31, enabled: true, position: 10 });
        expect(occasions[0]!.nextDate?.slice(5)).toBe('10-31');
        expect(Number(occasions[0]!.nextDate?.slice(0, 4))).toBeGreaterThanOrEqual(Number(nextHalloween));
        expect(calendars.map(calendar => calendar.calendar)).toEqual(['hebrew', 'islamic-umalqura']);
    });

    it('leaves the date out when a list has run out', async () => {
        const { service } = build([{ ...halloween, rule: { kind: 'dates', dates: ['2001-01-01'] } }]);
        expect((await service.list()).occasions[0]).not.toHaveProperty('nextDate');
    });

    it('trims the words and stores the rule it read', async () => {
        const { repository, service } = build();
        await service.add({ words: ' Founders Day ', ruleKind: 'fixed', month: 6, day: 1, enabled: true });
        expect(repository.add).toHaveBeenCalledWith({ words: 'Founders Day', rule: { kind: 'fixed', month: 6, day: 1 }, enabled: true });
    });

    it('refuses a rule that could never fall, with the reason, and stores nothing', async () => {
        const { repository, service } = build();
        await expect(service.add({ words: 'Nope', ruleKind: 'fixed', month: 6, day: 31, enabled: true })).rejects.toMatchObject({ statusCode: 400 });
        expect(repository.add).not.toHaveBeenCalled();
    });

    it('refuses words that are only space', async () => {
        const { service } = build();
        await expect(service.add({ words: '   ', ruleKind: 'easter', offsetDays: 0, enabled: true })).rejects.toMatchObject({ statusCode: 400 });
    });

    it('answers 404 for an occasion this station does not have', async () => {
        const { repository, service } = build();
        repository.change.mockResolvedValueOnce(undefined);
        repository.remove.mockResolvedValueOnce(false);
        await expect(service.change('b', { words: 'x', ruleKind: 'easter', offsetDays: 0, enabled: true })).rejects.toMatchObject({
            statusCode: 404,
        });
        await expect(service.remove('b')).rejects.toMatchObject({ statusCode: 404 });
    });
});
