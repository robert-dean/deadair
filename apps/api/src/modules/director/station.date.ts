/** Days in a week, which is what a weekday wraps at. */
const DAYS_IN_WEEK = 7;

/**
 * A date on the station's own calendar, with the weekday it falls on. Sunday is `0`.
 *
 * Wall-clock throughout: a date here is a reading of the station's clock rather than an instant, which
 * is what keeps everything that walks over dates free of daylight-saving arithmetic.
 */
export interface StationDate {
    year: number;
    /** 1-12, matching `StationClock`. */
    month: number;
    day: number;
    weekday: number;
}

const pad = (value: number, width = 2) => String(value).padStart(width, '0');

/** A station date as `YYYY-MM-DD`, the shape a special's dates are held and compared in as strings. */
export const dateKey = (date: Pick<StationDate, 'year' | 'month' | 'day'>): string => `${pad(date.year, 4)}-${pad(date.month)}-${pad(date.day)}`;

/**
 * A `YYYY-MM-DD` string as a station date, or `undefined` when it is not one.
 *
 * Through UTC, which is safe because this is civil arithmetic on a date rather than a claim about a
 * moment: UTC has no daylight saving, so it is the calendar with no opinions. The weekday is DERIVED
 * here rather than taken from anybody, since it is the one field a caller could get wrong in a way
 * that silently resolves the wrong show.
 */
export function stationDateOf(key: string): StationDate | undefined {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
    if (!match) return undefined;

    const asUtc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    if (dateKey({ year: asUtc.getUTCFullYear(), month: asUtc.getUTCMonth() + 1, day: asUtc.getUTCDate() }) !== key) return undefined;

    return { year: asUtc.getUTCFullYear(), month: asUtc.getUTCMonth() + 1, day: asUtc.getUTCDate(), weekday: asUtc.getUTCDay() };
}

/** The day `offset` days from `date` on the station's calendar. Plain civil arithmetic; see {@link stationDateOf}. */
export function addDays(date: StationDate, offset: number): StationDate {
    const asUtc = new Date(Date.UTC(date.year, date.month - 1, date.day + offset));

    return {
        year: asUtc.getUTCFullYear(),
        month: asUtc.getUTCMonth() + 1,
        day: asUtc.getUTCDate(),
        weekday: (((date.weekday + offset) % DAYS_IN_WEEK) + DAYS_IN_WEEK) % DAYS_IN_WEEK,
    };
}
