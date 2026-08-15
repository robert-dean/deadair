/**
 * The time, as a thing a station can say out loud.
 *
 * A break is written minutes before it airs and rendered into audio that cannot be re-cut, so a
 * segment naming an exact time is a segment that will be wrong by the time anybody hears it. The
 * station therefore says "just after nine" rather than "it's nine oh one", which is what a presenter
 * says anyway.
 *
 * ## The phrasing and its expiry are one object
 *
 * {@link roughTime} answers with the words AND the window they stay true in, because how long a
 * wording lasts is a fact about the wording: "just after nine" is good for a few minutes and
 * "coming up to half past" stops being true the moment it is half past. Deriving the window
 * somewhere else would be a second thing that can disagree with the first, and the disagreement
 * would only ever show up on air.
 *
 * The window is what `segments.claims_time_from` / `claims_time_until` are stamped from, and the
 * director checks it at hand-over exactly as it checks `claims_item_id`: a break whose words have
 * expired is dropped rather than aired. Silence on one boundary beats a wrong fact.
 *
 * ## Station-local, not UTC and not the server's
 *
 * A station is a place and its listeners are in it, so the zone is the operator's
 * ({@link CLOCK_KEYS.timezone}) and the host's is only the fallback. See
 * `docs/todo/station-moment.md`, which makes the same argument for everything else that will
 * eventually want to know what time it is.
 */

import type { AppConfig } from '@maroonedsoftware/appconfig';

/** The `deadair.settings` key. In the `station` group, beside its name and its presenter's. */
export const CLOCK_KEYS = {
    timezone: 'station.timezone',
} as const;

/**
 * Whether some words carry a given phrasing of the time.
 *
 * Case-insensitive, and that is not politeness: a model told to use these words verbatim will still
 * capitalise them at the start of a sentence, and a station whose break said "Coming up to three"
 * had its claim silently dropped for the capital C. Measured on the running station, where every
 * timed break the model wrote went to air unguarded.
 */
export const saysTime = (script: string, time: RoughTime): boolean => script.toLowerCase().includes(time.words.toLowerCase());

/** The time, said the way a presenter says it, and how long that stays true. */
export interface RoughTime {
    /** The words, with no leading capital and no trailing stop: a template decides the sentence. */
    words: string;
    /** Epoch millis this phrasing becomes true. */
    validFrom: number;
    /** Epoch millis it stops being true, exclusive. */
    validUntil: number;
}

/**
 * The operator's zone, or the host's.
 *
 * Not validated here. An IANA name the platform does not know makes `Intl.DateTimeFormat` throw,
 * and {@link roughTime} lets it: a station told it is in `Europe/Lundon` should say so loudly at the
 * first break rather than quietly report the server's idea of the hour for a month.
 */
export function stationZone(config: AppConfig): string {
    const set = config.get(CLOCK_KEYS.timezone, '').trim();
    return set.length > 0 ? set : Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * How the station reads each hour.
 *
 * Words rather than digits because these are spoken: a speech engine handed "9" may say "nine" and
 * may say "September", and which one is not worth finding out on air.
 */
const HOURS: readonly string[] = ['midnight', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'midday'];

/**
 * The phrasings, in minutes past the hour, each running until the next one starts.
 *
 * Two shapes alternating: `just after` a quarter that has passed, and `coming up to` one that has
 * not. That is the whole vocabulary, and it is deliberately small — every phrasing here has to be
 * true for its entire window, so a wording that pins the minute more tightly would buy precision
 * the projection cannot deliver and would expire before the audio finished rendering.
 *
 * Windows are seven or eight minutes. The projection they are checked against is exact over records
 * (every track in the catalog carries a duration) and loses only the unmeasured seconds of the
 * segments in between, so a minute of drift is the realistic worst case and this has room for
 * several. `next` marks the phrasings that name the hour AHEAD, which is what makes "coming up to
 * ten" arrive at ten to nine rather than ten to ten.
 */
const PHRASINGS: readonly { from: number; words: (hour: string, next: string) => string }[] = [
    { from: 0, words: hour => `just after ${hour}` },
    { from: 7, words: hour => `coming up to quarter past ${hour}` },
    { from: 15, words: hour => `just after quarter past ${hour}` },
    { from: 22, words: hour => `coming up to half past ${hour}` },
    { from: 30, words: hour => `just after half past ${hour}` },
    { from: 37, words: (_hour, next) => `coming up to quarter to ${next}` },
    { from: 45, words: (_hour, next) => `just after quarter to ${next}` },
    { from: 52, words: (_hour, next) => `coming up to ${next}` },
];

/**
 * What the station would say the time is, and for how long that holds.
 *
 * `at` is the instant the words are ABOUT — the slot a break was placed for — rather than the
 * instant they are being written, which is a quarter of an hour earlier and would produce a
 * phrasing that was stale before it was spoken.
 */
export function roughTime(at: number, zone: string): RoughTime {
    const { hour, minute } = wallClock(at, zone);

    // Seconds and milliseconds are read off the instant rather than out of the formatter, because
    // every zone offset there is is a whole number of minutes, so the two agree by construction and
    // one of them needs no parsing.
    const instant = new Date(at);
    const intoHour = (minute * 60 + instant.getUTCSeconds()) * 1000 + instant.getUTCMilliseconds();
    const hourStart = at - intoHour;

    // Walked forward rather than searched from the back: the list is short, sorted and never empty,
    // so this lands on the last phrasing whose window has opened and needs no bounds check.
    let index = 0;
    while (index + 1 < PHRASINGS.length && minute >= PHRASINGS[index + 1]!.from) index++;

    const phrasing = PHRASINGS[index]!;
    const ends = PHRASINGS[index + 1]?.from ?? 60;

    return {
        words: phrasing.words(spoken(hour), spoken(hour + 1)),
        validFrom: hourStart + phrasing.from * 60_000,
        validUntil: hourStart + ends * 60_000,
    };
}

/**
 * The parts of the day the station greets somebody in, and the hours each one covers.
 *
 * Three, and the gap is the point: there is deliberately nothing for the small hours. "Good night"
 * to somebody who has just tuned in is a goodbye, "good morning" at two is wrong, and a greeting is
 * the one part of a welcome the station can simply leave out — {@link dayGreeting} answers
 * `undefined` and the phrasing drops its optional chunk.
 */
const DAYPARTS: readonly { from: number; until: number; words: string }[] = [
    { from: 5, until: 12, words: 'good morning' },
    { from: 12, until: 18, words: 'good afternoon' },
    { from: 18, until: 22, words: 'good evening' },
];

/**
 * How the station greets somebody at this hour, and how long that stays true.
 *
 * A {@link RoughTime} rather than a string, and reusing it is the whole point: the words and the
 * window they hold in are one object because how long a wording lasts is a fact about the wording.
 * A daypart is that same idea with coarser bounds — "good morning" is good for hours where "just
 * after nine" is good for minutes — and the machinery either side of it is already built for the
 * pair. A break written at 11:56 and spoken at 12:02 has its claim checked at hand-over and is
 * dropped, exactly as one that named the time is.
 *
 * `at` is when the words will be SPOKEN, not when they are written; see {@link roughTime}, which
 * takes the same instant for the same reason.
 *
 * `undefined` in the small hours, which is an ordinary answer rather than a failure: see
 * {@link DAYPARTS}.
 */
export function dayGreeting(at: number, zone: string): RoughTime | undefined {
    const { hour, minute } = wallClock(at, zone);

    const part = DAYPARTS.find(daypart => hour >= daypart.from && hour < daypart.until);
    if (part === undefined) return undefined;

    // The same arithmetic `roughTime` uses, and for the same reason: every zone offset there is is a
    // whole number of minutes, so the wall clock and the instant agree by construction.
    const instant = new Date(at);
    const intoHour = (minute * 60 + instant.getUTCSeconds()) * 1000 + instant.getUTCMilliseconds();
    const hourStart = at - intoHour;

    return {
        words: part.words,
        validFrom: hourStart - (hour - part.from) * 3_600_000,
        validUntil: hourStart + (part.until - hour) * 3_600_000,
    };
}

/**
 * An hour of the day as the station reads it.
 *
 * Twelve-hour and without am or pm, because that is how a presenter says it and because the
 * listener already knows: somebody hearing this is awake at the time it describes.
 */
function spoken(hour: number): string {
    const wrapped = ((hour % 24) + 24) % 24;
    return HOURS[wrapped > 12 ? wrapped - 12 : wrapped]!;
}

/** The hour and minute an instant falls on where the station is. */
function wallClock(at: number, zone: string): { hour: number; minute: number } {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: zone,
        hourCycle: 'h23',
        hour: '2-digit',
        minute: '2-digit',
    }).formatToParts(new Date(at));

    const value = (type: string): number => Number(parts.find(part => part.type === type)?.value ?? '0');
    return { hour: value('hour'), minute: value('minute') };
}
