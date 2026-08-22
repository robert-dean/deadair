const TIME = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const STAMP = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
});
const FULL = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
const DAY = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

/**
 * When something happened, to the second.
 *
 * Its own helper rather than `shared/format.date`, which is deliberately day-precision: that one
 * answers "when did we last hear from this source", where a wall-clock time would imply a precision
 * nobody reading it cares about. This answers "in what order did tonight happen", where the seconds
 * are the whole point — a render that failed two seconds after a break was written is a different
 * story from one that failed an hour later.
 *
 * An absent or unparseable value renders as nothing rather than as `Invalid Date`.
 */
export function formatMoment(iso: string | undefined): string {
    const date = parse(iso);
    return date === undefined ? '' : TIME.format(date);
}

/**
 * A date and a wall-clock time on one line, in the operator's own zone, for a log tail.
 *
 * A log line is written as UTC and read by somebody sitting in a timezone. It carries its own date
 * because a retained tail routinely spans days and every line has to stand on its own: this is a
 * column somebody scans and copies out of, not a feed with headings. 12-hour explicitly, and with a
 * 2-digit hour so the column still lines up, because a log is read against the operator's memory of
 * their own day rather than against a clock.
 */
export function formatMomentStamp(iso: string | undefined): string {
    const date = parse(iso);
    return date === undefined ? '' : STAMP.format(date);
}

/** The same moment in full, for the tooltip: the list shows times and a feed can span days. */
export function formatMomentFull(iso: string | undefined): string {
    const date = parse(iso);
    return date === undefined ? '' : FULL.format(date);
}

/**
 * The calendar day, for deciding where one day ends and the next begins.
 *
 * `toDateString` rather than a formatted label, because this is compared and never shown: two
 * entries are on the same day or they are not, and a locale format that happened to omit the year
 * would make last August look like this one.
 */
export function dayOf(iso: string | undefined): string {
    const date = parse(iso);
    return date === undefined ? '' : date.toDateString();
}

/** The same day as a heading. The year is left off: a feed swept at 90 days cannot span one. */
export function formatDay(iso: string | undefined): string {
    const date = parse(iso);
    return date === undefined ? '' : DAY.format(date);
}

function parse(iso: string | undefined): Date | undefined {
    if (iso === undefined || iso === '') return undefined;

    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? undefined : date;
}
