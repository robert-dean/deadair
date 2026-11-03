// When an occasion falls. Each kind is pinned over several years, because a rule that holds this year
// and is a day out next year is the failure this file is here to catch, and it reads exactly as right.

import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';

import { stationDateOf, type StationDate } from '../../../src/modules/director/schedule.js';
import { easterSunday, occasionFalls, occasionFallsAt, type OccasionRule } from '../../../src/modules/schedule/occasion.rule.js';

const on = (key: string): StationDate => stationDateOf(key)!;

/** Every date in a year this rule falls on, so a rule that fires twice fails as surely as one that misses. */
function datesIn(rule: OccasionRule, year: number): string[] {
    const found: string[] = [];
    for (let day = DateTime.utc(year, 1, 1); day.year === year; day = day.plus({ days: 1 })) {
        const key = day.toFormat('yyyy-MM-dd');
        if (occasionFalls(rule, on(key))) found.push(key);
    }
    return found;
}

describe('a fixed date', () => {
    it('falls on that date every year and on no other', () => {
        const halloween: OccasionRule = { kind: 'fixed', month: 10, day: 31 };
        expect(datesIn(halloween, 2026)).toEqual(['2026-10-31']);
        expect(datesIn(halloween, 2027)).toEqual(['2027-10-31']);
    });

    it('never falls in a year without its date', () => {
        expect(datesIn({ kind: 'fixed', month: 2, day: 29 }, 2027)).toEqual([]);
        expect(datesIn({ kind: 'fixed', month: 2, day: 29 }, 2028)).toEqual(['2028-02-29']);
    });
});

describe('a weekday of a month', () => {
    const thanksgiving: OccasionRule = { kind: 'weekday', month: 11, ordinal: 4, weekday: 4 };

    it('finds Thanksgiving, the fourth Thursday of November, as it moves', () => {
        expect(datesIn(thanksgiving, 2026)).toEqual(['2026-11-26']);
        expect(datesIn(thanksgiving, 2027)).toEqual(['2027-11-25']);
        expect(datesIn(thanksgiving, 2028)).toEqual(['2028-11-23']);
    });

    it('finds the last of a weekday, whichever week that is', () => {
        const memorialDay: OccasionRule = { kind: 'weekday', month: 5, ordinal: -1, weekday: 1 };
        expect(datesIn(memorialDay, 2026)).toEqual(['2026-05-25']);
        expect(datesIn(memorialDay, 2027)).toEqual(['2027-05-31']);
    });

    it('finds the first of a weekday when the month opens on it', () => {
        // The first of May 2027 is a Saturday.
        expect(datesIn({ kind: 'weekday', month: 5, ordinal: 1, weekday: 6 }, 2027)).toEqual(['2027-05-01']);
    });

    it('never falls in a month without a fifth of that weekday', () => {
        // November 2026 has four Thursdays and five Sundays.
        expect(datesIn({ kind: 'weekday', month: 11, ordinal: 5, weekday: 4 }, 2026)).toEqual([]);
        expect(datesIn({ kind: 'weekday', month: 11, ordinal: 5, weekday: 0 }, 2026)).toEqual(['2026-11-29']);
    });
});

describe('Easter', () => {
    it.each([
        [2024, '2024-03-31'],
        [2025, '2025-04-20'],
        [2026, '2026-04-05'],
        [2027, '2027-03-28'],
        [2028, '2028-04-16'],
        [2029, '2029-04-01'],
        [2030, '2030-04-21'],
        // The earliest and the latest this century.
        [2008, '2008-03-23'],
        [2038, '2038-04-25'],
    ])('falls in %i on %s', (year, expected) => {
        expect(datesIn({ kind: 'easter', offsetDays: 0 }, year)).toEqual([expected]);
    });

    it('is always a Sunday', () => {
        for (let year = 2020; year < 2060; year++) {
            const { year: y, month, day } = easterSunday(year);
            expect(DateTime.utc(y, month, day).weekday).toBe(7);
        }
    });

    it('counts days either side of itself, across the end of a month', () => {
        // Good Friday 2029 is in March, and Easter Sunday is the first of April.
        expect(datesIn({ kind: 'easter', offsetDays: -2 }, 2029)).toEqual(['2029-03-30']);
        expect(datesIn({ kind: 'easter', offsetDays: 1 }, 2026)).toEqual(['2026-04-06']);
    });
});

describe('another calendar', () => {
    it.each([
        ['Rosh Hashanah', 'Tishri', 1, 2026, '2026-09-12'],
        ['Rosh Hashanah', 'Tishri', 1, 2027, '2027-10-02'],
        ['Rosh Hashanah', 'Tishri', 1, 2028, '2028-09-21'],
        ['Rosh Hashanah', 'Tishri', 1, 2029, '2029-09-10'],
        ['Yom Kippur', 'Tishri', 10, 2026, '2026-09-21'],
        ['Yom Kippur', 'Tishri', 10, 2027, '2027-10-11'],
        ['Hanukkah', 'Kislev', 25, 2026, '2026-12-05'],
        ['Hanukkah', 'Kislev', 25, 2027, '2027-12-25'],
        ['Hanukkah', 'Kislev', 25, 2028, '2028-12-13'],
    ])('finds %s in the Hebrew calendar (%s %i) in %i', (_name, calendarMonth, day, year, expected) => {
        expect(datesIn({ kind: 'calendar', calendar: 'hebrew', calendarMonth, day }, year)).toEqual([expected]);
    });

    it.each([
        ['Eid al-Fitr', 'Shawwal', 1, 2026, '2026-03-20'],
        ['Eid al-Fitr', 'Shawwal', 1, 2027, '2027-03-09'],
        ['Eid al-Adha', 'Dhuʻl-Hijjah', 10, 2026, '2026-05-27'],
        ['Eid al-Adha', 'Dhuʻl-Hijjah', 10, 2027, '2027-05-16'],
    ])('finds %s in the Umm al-Qura calendar (%s %i) in %i', (_name, calendarMonth, day, year, expected) => {
        expect(datesIn({ kind: 'calendar', calendar: 'islamic-umalqura', calendarMonth, day }, year)).toEqual([expected]);
    });

    it('answers nothing for a month that calendar does not have', () => {
        expect(datesIn({ kind: 'calendar', calendar: 'hebrew', calendarMonth: 'Shawwal', day: 1 }, 2026)).toEqual([]);
    });
});

describe('listed dates', () => {
    const rule: OccasionRule = { kind: 'dates', dates: ['2026-11-08', '2027-10-29'] };

    it('falls on exactly those dates', () => {
        expect(datesIn(rule, 2026)).toEqual(['2026-11-08']);
        expect(datesIn(rule, 2027)).toEqual(['2027-10-29']);
    });

    it('answers nothing once the list has run out', () => {
        expect(datesIn(rule, 2028)).toEqual([]);
    });
});

describe('an instant', () => {
    const halloween: OccasionRule = { kind: 'fixed', month: 10, day: 31 };

    it('is read as the date it is at the station, not in UTC', () => {
        // Ten past midnight UTC on the first of November is still Halloween night in Atlanta.
        const at = DateTime.utc(2026, 11, 1, 0, 10).toMillis();
        expect(occasionFallsAt(halloween, at, 'America/New_York')).toBe(true);
        expect(occasionFallsAt(halloween, at, 'UTC')).toBe(false);
    });

    it('is read as the next day already, east of the date line', () => {
        const at = DateTime.utc(2026, 10, 30, 12).toMillis();
        expect(occasionFallsAt(halloween, at, 'Pacific/Auckland')).toBe(true);
        expect(occasionFallsAt(halloween, at, 'America/New_York')).toBe(false);
    });

    it('reads the weekday on the station calendar too', () => {
        // Thanksgiving 2026 runs until 5am UTC on the Friday in New York.
        const thanksgiving: OccasionRule = { kind: 'weekday', month: 11, ordinal: 4, weekday: 4 };
        const at = DateTime.utc(2026, 11, 27, 4, 30).toMillis();
        expect(occasionFallsAt(thanksgiving, at, 'America/New_York')).toBe(true);
        expect(occasionFallsAt(thanksgiving, at, 'UTC')).toBe(false);
    });
});
