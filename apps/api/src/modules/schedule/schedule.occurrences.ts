import { addDays, isSpecial, piecesOn, type DayPiece, type ScheduleSlot, type StationDate } from '#modules/director/schedule.js';

export type { StationDate };

/**
 * The station's schedule as a timetable: what is on, on which day, between which two times.
 *
 * ## Why this exists at all
 *
 * The schedule stores a block per weekday mask, or per date range for a special; a timetable needs one
 * per DAY, with real dates on it and the specials already cut into the weekly blocks. Turning one into
 * the other belongs here rather than in a console, because the browser does not know
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

/**
 * Every block in `days` days from `from`, earliest first.
 *
 * They do NOT tile. A schedule is free to leave the afternoon unclaimed and the answer simply has
 * nothing there — what plays in that hour is the sustaining source's business rather than this
 * one's. Nor do they overlap: two weekly blocks or two specials are refused by `ScheduleService` on
 * the way IN, and a special that cuts into a weekly block is resolved HERE, on the way out, by drawing
 * the weekly block around it. That is the one place a precedence is drawn rather than refused, and it
 * is drawn so the grid shows what the resolver airs; see `director/schedule.ts`.
 */
export function project(from: StationDate, days: number, slots: readonly ScheduleSlot[]): ScheduleOccurrence[] {
    if (slots.length === 0 || days <= 0) return [];

    const occurrences: ScheduleOccurrence[] = [];

    let date = from;
    for (let index = 0; index < days; index++) {
        const next = addDays(date, 1);

        // Each day emits what lands ON it, rather than each block emitting where it goes. That is
        // what keeps every block inside the requested range: the tail of a block that started the
        // night before belongs to this morning, and the tail of one starting on the last day belongs
        // to a day nobody asked about. `piecesOn` is the resolver's own answer to "where is this
        // block today", so the grid and the station cannot disagree about it.
        const specials = slots.filter(isSpecial).flatMap(slot => piecesOn(slot, date));

        for (const slot of slots) {
            for (const piece of piecesOn(slot, date)) {
                const shown = isSpecial(slot) ? [piece] : around(piece, specials);
                for (const part of shown) occurrences.push(one(slot, date, part.from, part.to, next));
            }
        }

        date = next;
    }

    // Earliest first, which is what a caller drawing a column wants. Sorting on the stamp is safe
    // because they are fixed-width and zero-padded.
    return occurrences.sort((left, right) => left.start.localeCompare(right.start));
}

/**
 * What is left of a weekly block's piece once the specials on that day have cut into it: nothing, the
 * piece whole, or the parts either side of each special.
 */
function around(piece: DayPiece, cuts: readonly DayPiece[]): DayPiece[] {
    let left: DayPiece[] = [piece];

    for (const cut of cuts) {
        left = left.flatMap(part => {
            if (cut.to <= part.from || cut.from >= part.to) return [part];

            return [
                ...(cut.from > part.from ? [{ from: part.from, to: cut.from }] : []),
                ...(cut.to < part.to ? [{ from: cut.to, to: part.to }] : []),
            ];
        });
    }

    return left;
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

/**
 * `YYYY-MM-DD HH:mm:ss` for a station-local date and a minute of it.
 *
 * Exported because a reading of the station's clock is the same shape as a block's ends and has to
 * stay that way: `ScheduleService.current` sends both, and a caller works out how much of a block is
 * left by comparing them. Two formatters would be two chances to pad a field differently, and the
 * comparison is a string one.
 *
 * `seconds` is only ever set for a clock reading. A block boundary is a minute.
 */
export function stamp(date: StationDate, minutesOfDay: number, seconds = 0): string {
    const minute = ((minutesOfDay % MINUTES_IN_DAY) + MINUTES_IN_DAY) % MINUTES_IN_DAY;
    const pad = (value: number, width = 2) => String(value).padStart(width, '0');

    return `${pad(date.year, 4)}-${pad(date.month)}-${pad(date.day)} ${pad(Math.floor(minute / 60))}:${pad(minute % 60)}:${pad(seconds)}`;
}
