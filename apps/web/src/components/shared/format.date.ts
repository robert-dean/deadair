const FORMAT = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * A timestamp as a date the operator can read, in their own locale.
 *
 * Day precision, because everything this renders is a "when did we last hear from this source"
 * answer: the walk runs on a schedule measured in days and a wall-clock time would imply a
 * precision that matters to nobody reading it.
 *
 * An absent or unparseable value renders as nothing rather than as `Invalid Date`. The input is an
 * ISO string off the wire, so a value the API never sent and a value it sent wrong look the same
 * here, and neither is worth showing.
 */
export function formatDate(iso: string | undefined): string {
    if (iso === undefined || iso === '') return '';

    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '' : FORMAT.format(date);
}
