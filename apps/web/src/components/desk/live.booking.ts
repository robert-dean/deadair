import type { ScheduleOccurrence } from '@deadair/sdk';

/** The booked live show the Desk mentions, and when it is relative to now. */
export interface NextBooking {
    name: string;
    /** Whether it is on now, later today or tomorrow, on the station's own calendar. */
    when: 'now' | 'today' | 'tomorrow';
    /** Its start, or for one on now its end, as hours and minutes of the station's clock. */
    hour: number;
    minute: number;
}

/**
 * The first booked live show that has not ended, from a timetable of the station's today and
 * tomorrow, or `undefined` when there is none.
 *
 * Every stamp is the station's own zone-naive `YYYY-MM-DD HH:mm:ss`, as is `now`, so comparing them
 * as strings is the whole check and the browser's zone has no say. A show running past midnight
 * arrives as two blocks; the first one not yet over is the one that matters.
 */
export function nextBooking(occurrences: readonly ScheduleOccurrence[], now: string): NextBooking | undefined {
    const block = occurrences
        .filter(occurrence => occurrence.live === true && occurrence.end > now)
        .sort((a, b) => a.start.localeCompare(b.start))[0];
    if (block === undefined) return undefined;

    const on = block.start <= now;
    const [hour, minute] = (on ? block.end : block.start).slice(11, 16).split(':').map(Number);

    return {
        name: block.label,
        when: on ? 'now' : block.start.slice(0, 10) === now.slice(0, 10) ? 'today' : 'tomorrow',
        hour: hour ?? 0,
        minute: minute ?? 0,
    };
}
