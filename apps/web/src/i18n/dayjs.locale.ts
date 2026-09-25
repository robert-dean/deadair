import dayjs from 'dayjs';

/**
 * Teaches dayjs a language from the browser's own `Intl`, so Mantine's date pickers and the
 * timetable name their months and days in it.
 *
 * ## Why not dayjs's own locale files
 *
 * dayjs ships one file per language, 145 of them, as UMD scripts over a CommonJS core. Loading one
 * on demand means either importing every one of them into the bundle or teaching the bundler to
 * pre-bundle a glob of CommonJS deep imports, and either way the list of languages the console can
 * date in would be dayjs's list rather than the browser's. What Mantine actually reads off a locale
 * is month and weekday names, and `Intl` has those for any language a browser knows, including every
 * one a language pack can name.
 *
 * Registered under the lowercased tag, which is how dayjs looks a locale up, and without making it
 * dayjs's global default: `DatesProvider` passes the locale to each date it formats.
 */
export function registerDayjsLocale(locale: string): void {
    const name = locale.toLowerCase();
    // A Sunday (4 January 1970), and the twelve months of one year, all in UTC so the names do not
    // depend on the zone the browser is in.
    const day = (index: number) => new Date(Date.UTC(1970, 0, 4 + index));
    const month = (index: number) => new Date(Date.UTC(1970, index, 15));
    const names = (options: Intl.DateTimeFormatOptions, at: (index: number) => Date, count: number) => {
        const format = new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' });
        return Array.from({ length: count }, (_, index) => format.format(at(index)));
    };

    dayjs.locale(
        {
            name,
            // Standalone forms (`month` alone), which is what a calendar heading wants: in Russian or
            // Polish the month inside a full date is a different grammatical case.
            months: names({ month: 'long' }, month, 12),
            monthsShort: names({ month: 'short' }, month, 12),
            weekdays: names({ weekday: 'long' }, day, 7),
            weekdaysShort: names({ weekday: 'short' }, day, 7),
            weekdaysMin: names({ weekday: 'narrow' }, day, 7),
            ordinal: (n: number) => n,
            formats: {},
            relativeTime: {},
        },
        undefined,
        true,
    );
}
