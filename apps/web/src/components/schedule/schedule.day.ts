import type { ScheduleSlot } from '@deadair/sdk';

/**
 * Reading and writing the station's day, for the console alone.
 *
 * The API stores a start as minutes past midnight, which is the right shape for a resolver
 * comparing against a wall clock and the wrong one for a person. Everything that turns one into the
 * other lives here rather than in a component, because two places doing it differently is how a
 * schedule comes to show one time and fire at another.
 *
 * Sunday is 0, matching `Date.getDay()` and the API.
 */

export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const MINUTES_IN_DAY = 24 * 60;

/** `360` to `06:00`. Always two digits, so a column of these lines up under `.da-num`. */
export function minutesToClock(minutes: number): string {
    const hour = Math.floor(minutes / 60) % 24;
    const minute = minutes % 60;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * `06:00` to `360`, or `undefined` for anything that is not a time.
 *
 * Refused rather than coerced. A slot at a time nobody chose is a station changing over at an hour
 * an operator cannot account for, which is the same argument the clock-band parser makes for
 * dropping a line it cannot read instead of guessing at it.
 */
export function clockToMinutes(value: string): number | undefined {
    const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
    if (!match) return undefined;

    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) return undefined;

    return hour * 60 + minute;
}

/** Which days a slot runs on, in words. Empty means every day, which is what the API means by it. */
export function daysOf(slot: ScheduleSlot): string {
    const days = slot.days ?? [];
    if (days.length === 0 || days.length === DAY_LABELS.length) return 'Every day';

    // In week order rather than the order they were saved in, so two slots on the same days read
    // the same way.
    return [...days]
        .sort((a, b) => a - b)
        .map(day => DAY_LABELS[day] ?? '?')
        .join(', ');
}

/**
 * How long a slot runs, given the whole schedule.
 *
 * A slot's span is its NEIGHBOUR's start, which is why this takes the list: the answer changes when
 * a different slot moves, and a duration stored on the row would be a second copy of a fact that
 * can go stale. Only slots sharing a day can bound each other, and the last of a day wraps to the
 * first, which is what makes every instant land somewhere.
 *
 * `undefined` when nothing else runs on that day, meaning it holds until it comes round again.
 */
export function spanOf(slot: ScheduleSlot, slots: readonly ScheduleSlot[]): string | undefined {
    const runsTogether = slots.filter(other => sharesADay(other, slot));
    if (runsTogether.length < 2) return undefined;

    const starts = [...new Set(runsTogether.map(other => other.startsAtMinutes))].sort((a, b) => a - b);
    const after = starts.find(start => start > slot.startsAtMinutes) ?? starts[0]!;

    const length = (after - slot.startsAtMinutes + MINUTES_IN_DAY) % MINUTES_IN_DAY;
    if (length === 0) return undefined;

    const hours = Math.floor(length / 60);
    const minutes = length % 60;
    if (hours === 0) return `${minutes}m`;
    return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

/** Whether two slots ever run on the same day, which is what lets one bound the other. Empty is every day. */
function sharesADay(a: ScheduleSlot, b: ScheduleSlot): boolean {
    const left = a.days ?? [];
    const right = b.days ?? [];
    if (left.length === 0 || right.length === 0) return true;

    return left.some(day => right.includes(day));
}
