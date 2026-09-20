import { readClock } from '#modules/director/clock.bands.js';

/**
 * Which day the station is having, and how long it will still be having it.
 *
 * ## The station's day, not the server's and not UTC
 *
 * "What happened on this day" is a question about a calendar, and which calendar
 * is the operator's: a station in Auckland has been on the 21st for most of a
 * day while the server it runs on is still on the 20th. `stationZone` is the
 * same answer `clock.words.ts` gives about the hour, and this asks
 * `clock.bands.ts` rather than owning a third `formatToParts` — there were two
 * in this tree and a third is where they start disagreeing.
 *
 * ## Asked about the SLOT, not about now
 *
 * Every caller here passes the instant the words will be HEARD.
 * `BulletinSource.storiesFor` and `WeatherSource.readingFor` both take
 * `segments.airs_at` for the same reason, and the date is the sharpest version
 * of it: a break written at ten to midnight airs on a day whose history is not
 * the one the writer would have been shown. Nothing else in this feature can
 * recover from getting that wrong, because every entry it hands over is true of
 * a different day.
 *
 * ## The window is what the claim is stamped with
 *
 * "On this day in 1966" stops being true at midnight and not before, which is
 * exactly the shape `segments.claims_time_from`/`claims_time_until` already
 * hold. So an almanac break needs no new claim column and no new check: it
 * claims the day it was written for, and `break.claims.ts` drops it if it
 * reaches a slot outside it. That is the whole of its freshness story, and it is
 * a far kinder one than the weather's — a date cannot go stale in the twenty
 * minutes between writing and airing, only at the boundary of the day itself.
 */

/** One station day: the date a source is asked about, and how long it is still that date. */
export interface StationDay {
    /** The month, 1 to 12. */
    month: number;
    /** The day of the month. */
    day: number;
    /** `MM-DD`, which is what an almanac answers with and what a cache is keyed by. */
    date: string;
    /** Epoch millis this day began at, station-local. */
    from: number;
    /** Epoch millis it ends at, exclusive: the next local midnight. */
    until: number;
}

/**
 * The day an instant falls in, in the station's zone.
 *
 * @param at - The instant. A caller writing a break passes the moment it airs.
 * @param zone - `stationZone(config)`. An IANA name the platform does not know
 *   makes `Intl` throw, which is `stationZone`'s own deliberate loudness.
 */
export function stationDay(at: number, zone: string): StationDay {
    const clock = readClock(at, zone);

    return {
        month: clock.month,
        day: clock.day,
        date: `${pad(clock.month)}-${pad(clock.day)}`,
        from: lastMidnight(at, zone),
        until: nextMidnight(at, zone),
    };
}

/**
 * The instant the station's calendar day began at.
 *
 * Walked BACKWARDS an hour at a time until the date differs rather than by
 * subtracting the hours on the clock, and the difference is a day long: on the
 * morning the clocks go forward, subtracting 13 hours from one in the afternoon
 * lands an hour before midnight, so the day then measured 24 hours and the two
 * ends of it were both wrong. The trim is taken one hour PAST the boundary,
 * which is inside the new offset and so reads the right midnight.
 */
function lastMidnight(at: number, zone: string): number {
    const today = readClock(at, zone);

    for (let hours = 1; hours <= 26; hours++) {
        const candidate = at - hours * 3_600_000;
        const clock = readClock(candidate, zone);
        if (clock.day === today.day && clock.month === today.month) continue;

        const insideToday = candidate + 3_600_000;
        return midnightBefore(insideToday, readClock(insideToday, zone));
    }

    // Unreachable for any real zone, on {@link nextMidnight}'s reasoning.
    return midnightBefore(at, today);
}

/**
 * The instant the station's calendar day next turns over.
 *
 * Walked forward an hour at a time until the date changes and then trimmed back
 * to the minute, rather than by adding the hours left on the clock, because
 * arithmetic on a wall clock is where daylight saving hides — `nextOccurrence`'s
 * rule, and this is the cheap version of it: 26 formatter reads, once per break.
 *
 * One approximation is left, deliberately. A zone whose clocks change AT
 * midnight (a few have, historically) can put the trim an hour out, so a break
 * would claim the day for an hour too long or too little, twice a year. The
 * alternative is the full transition search in `clock.bands.ts` for a window
 * whose whole purpose is "until the date changes".
 */
function nextMidnight(at: number, zone: string): number {
    const today = readClock(at, zone);

    for (let hours = 1; hours <= 26; hours++) {
        const candidate = at + hours * 3_600_000;
        const clock = readClock(candidate, zone);
        if (clock.day === today.day && clock.month === today.month) continue;

        return midnightBefore(candidate, clock);
    }

    // Unreachable for any real zone, and a day that never ends is a break that
    // is never dropped for the date rather than a commit pass that throws.
    return at + 86_400_000;
}

/**
 * The midnight this instant's own day began at.
 *
 * Truncated to the second first, because a clock reading has no milliseconds and
 * an instant usually does: leaving them on made `alignedTo` answer a different
 * instant for the same slot on every pass, and a window whose bounds drift by
 * fractions of a second is the same bug in a place nobody would look for it.
 */
const midnightBefore = (at: number, clock: { hour: number; minute: number; second: number }): number =>
    Math.floor(at / 1_000) * 1_000 - (clock.hour * 3_600 + clock.minute * 60 + clock.second) * 1_000;

const pad = (value: number): string => String(value).padStart(2, '0');
