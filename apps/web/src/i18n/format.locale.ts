import { getClock } from '../clock.store';
import { i18n } from './i18n.setup';

/**
 * The locale dates, times and numbers are formatted in.
 *
 * Not the same thing as the language the words are in. A British operator reads English from the
 * `en` catalog and still expects `24 Sept 2026` rather than `Sep 24, 2026`, so this is the browser's
 * own most-preferred tag whose language matches the one on screen, and the bare language only when
 * none does. Before the console had a catalog every formatter passed `undefined` and got the
 * browser's first preference; for anybody reading the console in their own language, that is still
 * what this returns.
 */
export function formatLocale(): string {
    const language = i18n.resolvedLanguage ?? 'en';
    const preferred = typeof navigator === 'undefined' ? [] : navigator.languages;
    return preferred.find(tag => tag.toLowerCase().split('-')[0] === language) ?? language;
}

/**
 * The hour cycle a time is drawn on: the operator's clock if they chose one, else `otherwise`, the
 * habit of whichever screen is asking, else nothing, which leaves it to the locale.
 *
 * Spread into the options of any formatter that shows an hour. Settings, Appearance is where the
 * choice is made, and `clock.store.ts` says why `auto` is not a single rule.
 */
export function hourCycle(otherwise?: 'h12' | 'h23'): Pick<Intl.DateTimeFormatOptions, 'hourCycle'> {
    const clock = getClock();
    if (clock === '12') return { hourCycle: 'h12' };
    if (clock === '24') return { hourCycle: 'h23' };
    return otherwise === undefined ? {} : { hourCycle: otherwise };
}

/**
 * A formatter built once per locale and clock rather than on every call.
 *
 * The formatters used to be module constants, which is cheap and which fixes the locale at import:
 * a language change would re-render every word and leave every date as it was. The clock is in the
 * key for the same reason, so a formatter that never shows an hour is built once per clock for
 * nothing, which is three at most.
 */
export function perLocale<T>(build: (locale: string) => T): () => T {
    const built = new Map<string, T>();
    return () => {
        const locale = formatLocale();
        const key = `${locale}|${getClock()}`;
        let formatter = built.get(key);
        if (formatter === undefined) {
            formatter = build(locale);
            built.set(key, formatter);
        }
        return formatter;
    };
}

const COUNT = perLocale(locale => new Intl.NumberFormat(locale));

/** A whole number grouped the way the operator reads one: `12,345`, `12.345` or `12 345`. */
export function formatCount(value: number): string {
    return COUNT().format(value);
}

const MONEY = perLocale(() => new Map<string, { whole: Intl.NumberFormat; small: Intl.NumberFormat } | undefined>());

/**
 * An amount of money in the operator's way of writing one: `$1.23`, `1,23 €`.
 *
 * `currency` is the station's `metrics.currency`, typed by an operator, so it may not be a code
 * `Intl` knows; then the figure is written with the code after it rather than not at all. An amount
 * under one keeps three significant digits instead of the currency's two decimals, since a single
 * model call costs a fraction of a cent and `$0.00` would say it was free.
 */
export function formatMoney(value: number, currency: string): string {
    const formatters = MONEY();
    const code = currency.trim().toUpperCase();
    if (!formatters.has(code)) {
        try {
            const locale = formatLocale();
            formatters.set(code, {
                whole: new Intl.NumberFormat(locale, { style: 'currency', currency: code }),
                small: new Intl.NumberFormat(locale, { style: 'currency', currency: code, maximumSignificantDigits: 3 }),
            });
        } catch {
            formatters.set(code, undefined);
        }
    }
    const formatter = formatters.get(code);
    if (formatter === undefined) return `${new Intl.NumberFormat(formatLocale(), { maximumSignificantDigits: 4 }).format(value)} ${code}`;
    return (Math.abs(value) < 1 && value !== 0 ? formatter.small : formatter.whole).format(value);
}

const LIST = perLocale(locale => new Intl.ListFormat(locale, { type: 'conjunction' }));

/** Several things named in one phrase the way the operator joins them: `a, b and c`, `a, b y c`. */
export function formatList(items: readonly string[]): string {
    return LIST().format(items);
}

const WEEKDAY = perLocale(locale => new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }));

/**
 * A day of the week's short name, Sunday being 0 as it is for `Date.getDay()` and the API.
 *
 * Read from a fixed week in UTC (4 January 1970 was a Sunday) so the answer depends on nothing but
 * the day and the locale.
 */
export function weekdayShort(day: number): string {
    return WEEKDAY().format(new Date(Date.UTC(1970, 0, 4 + day)));
}

const CLOCK = perLocale(locale => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', ...hourCycle('h23') }));
const CLOCK_SECONDS = perLocale(
    locale => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit', ...hourCycle('h23') }),
);

/**
 * A wall-clock time on the 24-hour clock, whatever the locale's own habit, unless the operator chose
 * the 12-hour one.
 *
 * The on-air screens are read against `StationClock` in the corner, and a station runs on a
 * 24-hour day; these used to get that by asking for `en-GB`, which settled the language as well.
 */
export function formatClock(date: Date, options?: { seconds?: boolean }): string {
    return (options?.seconds === true ? CLOCK_SECONDS() : CLOCK()).format(date);
}

/** One formatter per locale, clock and zone, since a zone is fixed for as long as the station keeps it. */
const ZONED: Map<string, Intl.DateTimeFormat> = new Map();

/**
 * {@link formatClock} on another zone's clock: the station's, for an operator who is somewhere else.
 *
 * Answers `undefined` for a zone this browser does not know, which is a station set to a name its
 * server knows and the browser does not, rather than throwing out of a header that renders every
 * second.
 */
export function formatClockIn(date: Date, timeZone: string): string | undefined {
    const key = `${formatLocale()}|${getClock()}|${timeZone}`;
    let formatter = ZONED.get(key);
    if (formatter === undefined) {
        try {
            formatter = new Intl.DateTimeFormat(formatLocale(), { hour: '2-digit', minute: '2-digit', ...hourCycle('h23'), timeZone });
        } catch {
            return undefined;
        }
        ZONED.set(key, formatter);
    }
    return formatter.format(date);
}

/**
 * A station wall time given as an hour and a minute, with no date and no zone: a special's hours, a
 * band's minute past the hour. On the 24-hour clock unless the operator chose the 12-hour one, as
 * {@link formatClock} is. Drawn in UTC so that no zone can move it.
 */
const WALL_TIME = perLocale(locale => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', ...hourCycle('h23'), timeZone: 'UTC' }));

export function formatWallTime(hour: number, minute: number): string {
    return WALL_TIME().format(new Date(Date.UTC(1970, 0, 1, hour, minute)));
}

/**
 * The same choice for the Mantine pickers and the schedule grid, which take a dayjs pattern and a
 * picker format rather than `Intl` options. `auto` is 24-hour here, which is what they drew before.
 */
export function dayjsClock(): { time: string; hour: string; picker: '12h' | '24h' } {
    return getClock() === '12' ? { time: 'h:mm A', hour: 'h A', picker: '12h' } : { time: 'HH:mm', hour: 'HH:mm', picker: '24h' };
}
