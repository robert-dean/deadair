const STAMP = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
});
const FULL = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' });

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

function parse(iso: string | undefined): Date | undefined {
    if (iso === undefined || iso === '') return undefined;

    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? undefined : date;
}
