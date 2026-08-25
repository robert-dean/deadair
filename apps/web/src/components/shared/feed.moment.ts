const STAMP = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
});
const FULL = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
const MINUTE = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const MINUTE_WITH_WEEKDAY = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
});
const TIME_OF_DAY = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/**
 * When something happened: the date and the wall-clock time to the second, in the operator's own
 * zone.
 *
 * Its own helper rather than `shared/format.date`, which is deliberately day-precision: that one
 * answers "when did we last hear from this source", where a wall-clock time would imply a precision
 * nobody reading it cares about. This answers "in what order did tonight happen", where the seconds
 * are the whole point — a render that failed two seconds after a break was written is a different
 * story from one that failed an hour later.
 *
 * It carries its own date because everything reading it spans days: a feed loads older pages as an
 * operator scrolls and a retained log tail holds whatever was written since it last rotated. The
 * feeds used to answer that with a heading wherever the calendar day changed, which every list had
 * to know about; a row that says its own date needs nothing around it.
 *
 * 12-hour explicitly, with a 2-digit hour so the column still lines up, because these are read
 * against the operator's memory of their own day rather than against a clock.
 *
 * An absent or unparseable value renders as nothing rather than as `Invalid Date`. The input is an
 * ISO string off the wire, so a value the API never sent and a value it sent wrong look the same
 * here, and neither is worth showing.
 */
export function formatMomentStamp(iso: string | undefined): string {
    const date = parse(iso);
    return date === undefined ? '' : STAMP.format(date);
}

/** The same moment in full, for the tooltip: the column abbreviates the month and drops the year. */
export function formatMomentFull(iso: string | undefined): string {
    const date = parse(iso);
    return date === undefined ? '' : FULL.format(date);
}

/**
 * When something happened, to the minute.
 *
 * The third precision this console needs and the one three pages had each built for themselves: a
 * catalog page saying when a copy was last fetched, a production saying when it is due, both to the
 * minute because seconds are noise on a question measured in hours. `weekday` is for a moment far
 * enough ahead that the date alone does not place it.
 *
 * The `fallback` is a parameter rather than the empty string these helpers otherwise return, because
 * these read inside sentences and inside table cells, where a blank is a cell that looks broken. The
 * callers that want an em dash ask for one.
 */
export function formatMomentMinute(iso: string | undefined, options?: { weekday?: boolean; fallback?: string }): string {
    const date = parse(iso);
    if (date === undefined) return options?.fallback ?? '';

    return options?.weekday === true ? MINUTE_WITH_WEEKDAY.format(date) : MINUTE.format(date);
}

/**
 * The wall-clock time alone, for a reading taken so recently that the date is today by construction.
 */
export function formatTimeOfDay(iso: string | undefined, fallback = ''): string {
    const date = parse(iso);
    return date === undefined ? fallback : TIME_OF_DAY.format(date);
}

function parse(iso: string | undefined): Date | undefined {
    if (iso === undefined || iso === '') return undefined;

    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? undefined : date;
}
