import { readClock } from '#modules/director/clock.bands.js';
import { addDays, dateKey, type StationDate } from '#modules/director/schedule.js';

/**
 * When an occasion falls, as a rule rather than as a date, because most of them move.
 *
 * Five kinds and no library. A month and a day cannot say Thanksgiving, and every holiday calendar
 * package brings its dependency tree and share-alike data with it for a station that only ever asks
 * one question: is today the day. Everything here answers that from what the platform already holds.
 *
 * **The Chinese calendar is deliberately absent.** `Intl`'s reading of it put Lunar New Year a day out
 * in 2027 and 2030, two years of the ten measured, and a presenter wishing the listener a happy new
 * year on the wrong day is the failure this exists to avoid. A date this cannot work out is listed
 * instead, with the `dates` kind. The two calendars offered were checked over several years, which
 * `tests/modules/schedule/occasion.rule.test.ts` pins. `islamic-umalqura` is a calculated calendar, so
 * a community going by the sighted moon may keep the day a day either side of it.
 *
 * Every read is of a civil date on the station's own calendar, so nothing below depends on a zone
 * except {@link occasionFallsAt}, the one door an instant comes in through.
 */
export type OccasionRule =
    /** The same date every year. */
    | { kind: 'fixed'; month: number; day: number }
    /** The nth of a weekday in a month, 1 to 5, or -1 for the last. `weekday` is 0 for Sunday, as {@link StationDate}'s is. */
    | { kind: 'weekday'; month: number; ordinal: number; weekday: number }
    /** So many days from Western Easter Sunday: 0 is the day itself and -2 is Good Friday. */
    | { kind: 'easter'; offsetDays: number }
    /** A date in another calendar, its month named as `Intl` names it in English: `Tishri`, `Shawwal`. */
    | { kind: 'calendar'; calendar: OccasionCalendar; calendarMonth: string; day: number }
    /** The dates themselves, as `YYYY-MM-DD`, for what no rule here can work out. These run out. */
    | { kind: 'dates'; dates: readonly string[] };

export const OCCASION_CALENDARS = ['hebrew', 'islamic-umalqura'] as const;
export type OccasionCalendar = (typeof OCCASION_CALENDARS)[number];

/** Whether an occasion with this rule falls on this date on the station's calendar. */
export function occasionFalls(rule: OccasionRule, date: StationDate): boolean {
    switch (rule.kind) {
        case 'fixed':
            return date.month === rule.month && date.day === rule.day;
        case 'weekday':
            return date.month === rule.month && date.weekday === rule.weekday && isNthOfMonth(date, rule.ordinal);
        case 'easter':
            return dateKey(addDays(easterSunday(date.year), rule.offsetDays)) === dateKey(date);
        case 'calendar': {
            const there = inCalendar(date, rule.calendar);
            return there.month === rule.calendarMonth && there.day === rule.day;
        }
        case 'dates':
            return rule.dates.includes(dateKey(date));
    }
}

/** {@link occasionFalls} for an instant, read as the date it is in the station's zone. */
export function occasionFallsAt(rule: OccasionRule, at: number, zone: string): boolean {
    const { year, month, day, weekday } = readClock(at, zone);
    return occasionFalls(rule, { year, month, day, weekday });
}

/** Whether this date is the nth of its weekday in its month, or the last of them for `-1`. */
function isNthOfMonth(date: StationDate, ordinal: number): boolean {
    if (ordinal === -1) return addDays(date, 7).month !== date.month;
    return Math.ceil(date.day / 7) === ordinal;
}

/**
 * Western Easter Sunday in a year: the anonymous Gregorian computus, which is arithmetic and has no
 * table to run out.
 */
export function easterSunday(year: number): StationDate {
    const golden = year % 19;
    const century = Math.floor(year / 100);
    const ofCentury = year % 100;
    const leapCenturies = Math.floor(century / 4);
    const moonCorrection = Math.floor((century - Math.floor((century + 8) / 25) + 1) / 3);
    const epact = (19 * golden + century - leapCenturies - moonCorrection + 15) % 30;
    const toSunday = (32 + 2 * (century % 4) + 2 * Math.floor(ofCentury / 4) - epact - (ofCentury % 4)) % 7;
    const shift = Math.floor((golden + 11 * epact + 22 * toSunday) / 451);
    const count = epact + toSunday - 7 * shift + 114;

    return { year, month: Math.floor(count / 31), day: (count % 31) + 1, weekday: 0 };
}

const FORMATS = new Map<OccasionCalendar, Intl.DateTimeFormat>(
    OCCASION_CALENDARS.map(calendar => [calendar, new Intl.DateTimeFormat('en-US', { calendar, timeZone: 'UTC', month: 'long', day: 'numeric' })]),
);

/** This civil date in another calendar. Read at noon in UTC, because it is a date here and has no zone left to apply. */
function inCalendar(date: StationDate, calendar: OccasionCalendar): { month: string; day: number } {
    const parts = FORMATS.get(calendar)!.formatToParts(new Date(Date.UTC(date.year, date.month - 1, date.day, 12)));
    return {
        month: parts.find(part => part.type === 'month')?.value ?? '',
        day: Number(parts.find(part => part.type === 'day')?.value),
    };
}
