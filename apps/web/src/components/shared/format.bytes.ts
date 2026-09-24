/** The units a station's own volume is ever described in. Nothing here holds a terabyte in one store. */
import { perLocale } from '../../i18n/format.locale';

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

// Fixed places, as `toFixed` gave, with the operator's own decimal mark. Nothing below terabytes
// reaches four digits, so the grouping only ever shows on a figure past the last unit.
const WHOLE = perLocale(locale => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }));
const ONE_PLACE = perLocale(locale => new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }));

/**
 * A byte count as a person would say it.
 *
 * Binary steps with the short names, which is what every file manager the operator already uses
 * does and what `du -h` prints — being pedantically correct about KiB here would make this column
 * disagree with the terminal it is going to be checked against.
 *
 * One decimal place from a megabyte up and none below, because "1.5 GB" is the number somebody
 * reasons about and "1536.0 KB" is not. Zero is `0 B` rather than a dash: a store with nothing in it
 * is a fact, and the dash is reserved for a figure nothing recorded.
 */
export function formatBytes(bytes: number | undefined): string {
    if (bytes === undefined) return '—';
    if (bytes <= 0) return '0 B';

    const step = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1);
    const value = bytes / 1024 ** step;

    return `${(step >= 2 ? ONE_PLACE : WHOLE)().format(value)} ${UNITS[step]}`;
}
