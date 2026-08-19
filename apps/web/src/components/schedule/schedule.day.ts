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

/**
 * Civil arithmetic on a `YYYY-MM-DD` string.
 *
 * Through `Date.UTC`, which is right here precisely because these are NOT instants: a station date
 * is a reading on the station's calendar, and UTC is simply the calendar with no daylight saving to
 * have an opinion about. Using the browser's local zone would put the console a day out for anyone
 * whose midnight falls on the other side of the station's.
 */
export function addDays(date: string, days: number): string {
    const [year, month, day] = date.split('-').map(Number);
    const moved = new Date(Date.UTC(year!, month! - 1, day! + days));

    const pad = (value: number, width = 2) => String(value).padStart(width, '0');
    return `${pad(moved.getUTCFullYear(), 4)}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())}`;
}

/** Which weekday a `YYYY-MM-DD` falls on, Sunday `0`. Same civil-arithmetic argument as {@link addDays}. */
export function weekdayOf(date: string): number {
    const [year, month, day] = date.split('-').map(Number);
    return new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
}

/**
 * A stable colour per slot, so one show is one colour across the week.
 *
 * Red and yellow are deliberately absent. `status.ts` owns those — red means ON AIR in this console
 * and amber means something is broken — and a show that happened to hash into either would be
 * claiming a state rather than an identity.
 */
const SLOT_COLORS = ['teal', 'blue', 'grape', 'orange', 'green', 'cyan'] as const;

export function colorOf(slotId: string): string {
    let hash = 0;
    for (const character of slotId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;

    return SLOT_COLORS[hash % SLOT_COLORS.length]!;
}
