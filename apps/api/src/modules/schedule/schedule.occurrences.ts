import type { ScheduleSlot } from '#modules/director/schedule.js';

/**
 * The station's schedule as a timetable: what is on, on which day, between which two times.
 *
 * ## Why this exists at all
 *
 * The schedule stores a block per weekday mask; a timetable needs one per DAY, with real dates on it.
 * Turning one into the other belongs here rather than in a console, because the browser does not know
 * `station.timezone` and has no business deriving real dates from a weekday mask.
 *
 * ## It is wall-clock throughout, and never touches an instant
 *
 * Which is what keeps it as free of daylight-saving arithmetic as the resolver beside it. The caller
 * hands over one anchoring date and its weekday; walking forward is calendar arithmetic on
 * `(year, month, day)` with the weekday advancing by one, and every time emitted is a station-local
 * reading rather than a moment. A spring-forward day has 23 real hours and is still described
 * correctly by a 00:00-to-24:00 partition, because that partition is a statement about the clock
 * rather than about elapsed time.
 *
 * ## Every block stays inside one day
 *
 * A slot that runs from 22:00 to 06:00 comes back as two: one at the bottom of its day and one at
 * the top of the next. That is what a timetable draws anyway, and it means a consumer never has to
 * clip anything.
 *
 * ## Gaps are real, and are simply absent
 *
 * A schedule need not cover the day. The hours nothing claims come back as nothing at all, because
 * what plays there is not a slot: it is the station's sustaining source, which is a different fact
 * and belongs to whoever is asking about the station rather than to a drawing of its schedule.
 */

/** A date on the station's own calendar, with the weekday it falls on. Sunday is `0`. */
export interface StationDate {
    year: number;
    /** 1-12, matching {@link StationClock}. */
    month: number;
    day: number;
    weekday: number;
}

/**
 * One block of a timetable: this slot, on this day, between these two times.
 *
 * The times are station-local and deliberately carry NO offset. That is the format
 * `@mantine/schedule` takes, and the absence is what makes it right: a zone-naive string renders as
 * written, so a slot at six in the morning draws at six whatever zone the operator's browser is in.
 * Anything carrying an offset would be re-interpreted locally and the grid would quietly disagree
 * with the station for everyone not sitting in `station.timezone`.
 */
export interface ScheduleOccurrence {
    slotId: string;
    label: string;
    /** `YYYY-MM-DD HH:mm:ss`, station-local. */
    start: string;
    /** The same, exclusive. Midnight at the end of a day is the NEXT day's `00:00:00`. */
    end: string;
}

const MINUTES_IN_DAY = 24 * 60;
const DAYS_IN_WEEK = 7;

/**
 * Every block in `days` days from `from`, earliest first.
 *
 * They do NOT tile. A schedule is free to leave the afternoon unclaimed and the answer simply has
 * nothing there — what plays in that hour is the sustaining source's business rather than this
 * one's. Nor do they overlap, which `ScheduleService` refuses on the way IN rather than this
 * resolving on the way out.
 */
export function project(from: StationDate, days: number, slots: readonly ScheduleSlot[]): ScheduleOccurrence[] {
    if (slots.length === 0 || days <= 0) return [];

    const occurrences: ScheduleOccurrence[] = [];

    let date = from;
    for (let index = 0; index < days; index++) {
        const next = nextDate(date);
        const yesterday = (date.weekday - 1 + DAYS_IN_WEEK) % DAYS_IN_WEEK;

        // Each day emits what lands ON it, rather than each block emitting where it goes. That is
        // what keeps every block inside the requested range: the tail of a block that started the
        // night before belongs to this morning, and the tail of one starting on the last day belongs
        // to a day nobody asked about.
        for (const slot of slots) {
            const overnight = slot.endsAtMinutes <= slot.startsAtMinutes;

            // Last night's block, still running.
            if (overnight && slot.endsAtMinutes > 0 && runsOn(slot, yesterday)) occurrences.push(one(slot, date, 0, slot.endsAtMinutes, next));

            // And today's own, cut off at midnight when it runs past it.
            if (runsOn(slot, date.weekday)) {
                occurrences.push(one(slot, date, slot.startsAtMinutes, overnight ? MINUTES_IN_DAY : slot.endsAtMinutes, next));
            }
        }

        date = next;
    }

    // Earliest first, which is what a caller drawing a column wants. Sorting on the stamp is safe
    // because they are fixed-width and zero-padded.
    return occurrences.sort((left, right) => left.start.localeCompare(right.start));
}

/** One block as the wire shape. A whole day ends at the NEXT midnight rather than at 24:00, which is not a time. */
function one(slot: ScheduleSlot, date: StationDate, from: number, until: number, next: StationDate): ScheduleOccurrence {
    return {
        slotId: slot.id,
        label: slot.label,
        start: stamp(date, from),
        end: until >= MINUTES_IN_DAY ? stamp(next, 0) : stamp(date, until),
    };
}

/** Whether this slot runs on a given weekday. Empty `days` is every day, as everywhere else. */
const runsOn = (slot: ScheduleSlot, weekday: number): boolean => slot.days.length === 0 || slot.days.includes(weekday);

/** `YYYY-MM-DD HH:mm:ss` for a station-local date and a minute of it. */
function stamp(date: StationDate, minutesOfDay: number): string {
    const minute = ((minutesOfDay % MINUTES_IN_DAY) + MINUTES_IN_DAY) % MINUTES_IN_DAY;
    const pad = (value: number, width = 2) => String(value).padStart(width, '0');

    return `${pad(date.year, 4)}-${pad(date.month)}-${pad(date.day)} ${pad(Math.floor(minute / 60))}:${pad(minute % 60)}:00`;
}

/**
 * The next day on the station's calendar.
 *
 * Plain civil arithmetic through `Date.UTC`, which is safe here precisely because these are not
 * instants: UTC has no daylight saving, so using it to add a day to a `(year, month, day)` triple is
 * calendar arithmetic with a well-behaved implementation rather than a claim about elapsed time. The
 * weekday advances by one regardless, which is true of every calendar in use.
 */
function nextDate(date: StationDate): StationDate {
    const asUtc = new Date(Date.UTC(date.year, date.month - 1, date.day + 1));

    return {
        year: asUtc.getUTCFullYear(),
        month: asUtc.getUTCMonth() + 1,
        day: asUtc.getUTCDate(),
        weekday: (date.weekday + 1) % DAYS_IN_WEEK,
    };
}
