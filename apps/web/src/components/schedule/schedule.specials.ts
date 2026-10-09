import type { ScheduleSlot } from '@deadair/sdk';

import { perLocale } from '../../i18n/format.locale';
import { addDays } from './schedule.day';

/**
 * Reading the station's specials, for the console alone.
 *
 * A special is a slot with a first and last date. Whether it is coming up, on now or over is a
 * question about the STATION's calendar, so every function here takes the station's today as a
 * `YYYY-MM-DD` string (the date half of `GET /schedule/current`'s `now`) rather than reading the
 * browser's clock, which is a day out for anybody whose midnight falls on the other side of the
 * station's.
 */

/** A slot that runs on dates rather than every week. */
export type Special = ScheduleSlot & { startsOn: string; endsOn: string };

/** Whether a slot is a special. */
export const isSpecial = (slot: ScheduleSlot): slot is Special => slot.startsOn !== undefined && slot.endsOn !== undefined;

/** Where a special stands against the station's today. */
export type SpecialState = 'now' | 'upcoming' | 'over';

/**
 * The next run of a special that is not over, as its first and last date, or `undefined` once a
 * one-off has ended. A yearly special always has one: this year's if it has not ended yet, else
 * next year's. A run already under way is the current one, so "now" is a run whose first date has
 * passed and whose last has not.
 */
export function nextRun(special: Special, today: string): { from: string; to: string } | undefined {
    if (!special.yearly) return special.endsOn < today ? undefined : { from: special.startsOn, to: special.endsOn };

    // The span in days is kept, so a range across New Year lands on the right second year.
    const span = daysBetween(special.startsOn, special.endsOn);
    const year = Number(today.slice(0, 4));

    // Four years ahead, because a special on the 29th of February runs only in a leap year, which is
    // what the station's resolver does too: it compares the month and day, and most years have no 29th.
    for (let candidate = year - 1; candidate <= year + 4; candidate++) {
        const from = withYear(special.startsOn, candidate);
        if (from === undefined) continue;
        const to = addDays(from, span);
        if (to >= today) return { from, to };
    }

    return undefined;
}

/** Whether a special is on today, coming up, or over for good. */
export function stateOf(special: Special, today: string): SpecialState {
    const run = nextRun(special, today);
    if (run === undefined) return 'over';

    return run.from <= today ? 'now' : 'upcoming';
}

/**
 * The specials in the order an operator wants them: what is on now, then what is coming soonest,
 * then the one-offs that are over, most recent first.
 */
export function inOrder(specials: readonly Special[], today: string): Special[] {
    const keyOf = (special: Special): string => {
        const run = nextRun(special, today);
        // Over sorts last; among those, the most recent end first, hence the inverted date.
        return run === undefined ? `9${invert(special.endsOn)}` : `${run.from <= today ? '0' : '1'}${run.from}`;
    };

    return [...specials].sort((left, right) => keyOf(left).localeCompare(keyOf(right)) || left.label.localeCompare(right.label));
}

const DAY_MONTH = perLocale(locale => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }));
const DAY_MONTH_YEAR = perLocale(locale => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }));

/**
 * A run of dates as somebody would write it: `31 Oct`, `24–26 Dec`, `30 Dec – 2 Jan`, with the year
 * only when the special does not repeat, because a yearly special's year is not part of it.
 */
export function formatDates(from: string, to: string, withYear: boolean): string {
    const format = withYear ? DAY_MONTH_YEAR() : DAY_MONTH();
    const start = asDate(from);

    return from === to ? format.format(start) : format.formatRange(start, asDate(to));
}

/** A `YYYY-MM-DD` date as midnight UTC, which is how every formatter here reads it. */
function asDate(date: string): Date {
    const [year, month, day] = date.split('-').map(Number);
    return new Date(Date.UTC(year!, month! - 1, day!));
}

function daysBetween(from: string, to: string): number {
    return Math.round((asDate(to).getTime() - asDate(from).getTime()) / 86_400_000);
}

/** The same month and day in another year, or `undefined` for the 29th of February outside a leap year. */
function withYear(date: string, year: number): string | undefined {
    const [, month, day] = date.split('-').map(Number);
    if (month === 2 && day === 29 && new Date(Date.UTC(year, 1, 29)).getUTCMonth() !== 1) return undefined;

    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** A date string turned so that sorting it ascending sorts the dates descending. */
const invert = (date: string): string => date.replace(/\d/g, digit => String(9 - Number(digit)));
