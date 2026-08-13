const TIME = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const FULL = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' });

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

/** The same moment in full, for the tooltip: the list shows times and a feed can span days. */
export function formatMomentFull(iso: string | undefined): string {
    const date = parse(iso);
    return date === undefined ? '' : FULL.format(date);
}

/** The calendar day, so the list can say where one day ends and the next begins. */
export function dayOf(iso: string | undefined): string {
    const date = parse(iso);
    return date === undefined ? '' : date.toDateString();
}

function parse(iso: string | undefined): Date | undefined {
    if (iso === undefined || iso === '') return undefined;

    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? undefined : date;
}
