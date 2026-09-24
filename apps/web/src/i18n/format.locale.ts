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
 * A formatter built once per locale rather than on every call.
 *
 * The formatters used to be module constants, which is cheap and which fixes the locale at import:
 * a language change would re-render every word and leave every date as it was.
 */
export function perLocale<T>(build: (locale: string) => T): () => T {
    const built = new Map<string, T>();
    return () => {
        const locale = formatLocale();
        let formatter = built.get(locale);
        if (formatter === undefined) {
            formatter = build(locale);
            built.set(locale, formatter);
        }
        return formatter;
    };
}

const COUNT = perLocale(locale => new Intl.NumberFormat(locale));

/** A whole number grouped the way the operator reads one: `12,345`, `12.345` or `12 345`. */
export function formatCount(value: number): string {
    return COUNT().format(value);
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

const CLOCK = perLocale(locale => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }));
const CLOCK_SECONDS = perLocale(
    locale => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }),
);

/**
 * A wall-clock time on the 24-hour clock, whatever the locale's own habit.
 *
 * The on-air screens are read against `StationClock` in the corner, and a station runs on a
 * 24-hour day; these used to get that by asking for `en-GB`, which settled the language as well.
 */
export function formatClock(date: Date, options?: { seconds?: boolean }): string {
    return (options?.seconds === true ? CLOCK_SECONDS() : CLOCK()).format(date);
}
