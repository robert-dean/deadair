import { slotAt, type ScheduleSlot } from '#modules/director/schedule.js';

/**
 * The station's schedule as a timetable: what is on, on which day, between which two times.
 *
 * ## Why this exists at all
 *
 * The schedule stores STARTS. A slot runs until the next one begins and the last of the week wraps
 * round, which is what makes every instant land somewhere with no gap to represent and no overlap to
 * resolve. A timetable needs the opposite shape — blocks with both ends — so something has to turn
 * one into the other, and it is better here than in a console: the browser does not know
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
 * A slot that runs from 22:00 to 06:00 comes back as two blocks: one at the bottom of its day and
 * one at the top of the next. That is what a timetable draws anyway, and it means a consumer never
 * has to clip anything.
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
 * Every block covering `days` days from `from`, in order.
 *
 * The blocks TILE the range: contiguous, no gaps, no overlaps, from `from 00:00:00` to the midnight
 * that ends the last day. That is a property of the partition rather than something this arranges,
 * and it is what the tests assert.
 *
 * Answers nothing at all for a station with no schedule, which is an ordinary state: a station that
 * has never opened the page keeps playing whatever it was put on.
 */
export function project(from: StationDate, days: number, slots: readonly ScheduleSlot[]): ScheduleOccurrence[] {
    if (slots.length === 0 || days <= 0) return [];

    const occurrences: ScheduleOccurrence[] = [];

    let date = from;
    for (let index = 0; index < days; index++) {
        const next = nextDate(date);

        // The starts that fall on this day, in order. A slot running on no day here contributes
        // nothing, and two slots at one minute collapse to one boundary — which the unique index
        // refuses anyway, so it is a defence rather than a case.
        const starts = [...new Set(slots.filter(slot => runsOn(slot, date.weekday)).map(slot => slot.startsAtMinutes))].sort((a, b) => a - b);

        // Midnight is covered by whatever was in force then, which is usually the previous day's
        // last slot and is the whole reason the day columns are not independent. Asking `slotAt`
        // rather than reaching backwards by hand is what keeps this and the tick one implementation.
        const boundaries = starts[0] === 0 ? starts : [0, ...starts];

        boundaries.forEach((minute, position) => {
            const slot = slotAt(date.weekday, minute, slots);
            if (slot === undefined) return;

            const until = boundaries[position + 1];
            // The last block of a day ends at the next day's midnight rather than at 24:00, which is
            // not a time. Consumers get a real timestamp either way.
            const end = until === undefined ? stamp(next, 0) : stamp(date, until);

            // A boundary where the SAME slot continues is not a boundary, and drawing one would be
            // a lie about what the station does. It happens whenever the slot in force at midnight
            // is also the one starting later that day — an every-day slot wrapping into its own next
            // morning, which is the ordinary state of a station with one slot. The tick compares
            // slot IDS, so it fires no changeover there either; merging is what keeps the timetable
            // saying the same thing.
            //
            // Within a day only, which is what `position > 0` buys: the first boundary of a day is
            // always midnight, and merging there would join yesterday's block to today's and produce
            // something a day column has to clip. Clipping is the thing this deliberately never asks
            // a consumer to do.
            const previous = occurrences.at(-1);
            if (position > 0 && previous?.slotId === slot.id) {
                previous.end = end;
                return;
            }

            occurrences.push({ slotId: slot.id, label: slot.label, start: stamp(date, minute), end });
        });

        date = next;
    }

    return occurrences;
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
