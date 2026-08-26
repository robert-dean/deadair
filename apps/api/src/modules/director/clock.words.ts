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

/**
 * The window a script's own words hold it to, out of everything it was offered, or `undefined`.
 *
 * A break can be told the time two ways — the hour as {@link roughTime} and the half of the day as
 * {@link dayPart} — and may use either, both or neither. Each is a claim with its own lifetime, so
 * the answer is the INTERSECTION of the ones it actually made: a break saying both "just after half
 * past eleven" and "this morning" is stale the moment the first expires, and one saying only "this
 * morning" is good until noon.
 *
 * Undefined when the script made no time claim at all, which is the ordinary case and is what keeps
 * a break that never mentioned the hour from being dropped for a promise it did not make. Absent
 * offers are skipped, so a caller can hand over whatever the moment happened to have.
 */
export function timeClaimIn(script: string, ...offered: readonly (RoughTime | undefined)[]): { from: number; until: number } | undefined {
    const said = offered.filter((time): time is RoughTime => time !== undefined && saysTime(script, time));
    if (said.length === 0) return undefined;

    return {
        from: Math.max(...said.map(time => time.validFrom)),
        until: Math.min(...said.map(time => time.validUntil)),
    };
}

/**
 * The daypart a script names that cannot be true, given the one it was told, or `undefined`.
 *
 * ## Why this is not an equality check
 *
 * The prompt already asks, in as many words, and a model still does not always comply: of the nine
 * scripts this station wrote that named a daypart while having been told one, three agreed and six
 * did not — and every one of the six had reached for "tonight". So asking is necessary and is
 * demonstrably not sufficient.
 *
 * But refusing everything that is not the exact word told would refuse half of those six for
 * nothing. Three of them were told "this evening" and said "tonight", which is not an error: a
 * presenter at nine in the evening may call it either, and {@link DAYPARTS_ROUND_THE_CLOCK} draws
 * the line at ten only because a table has to draw it somewhere. The other three were told "this
 * morning" or "this afternoon" and still said "tonight", which is the failure a listener actually
 * hears.
 *
 * So what is compared is not the words but which STRETCH they name, and evening and tonight are the
 * one pair that names the same stretch. Everything else has to match: morning and afternoon are not
 * interchangeable with each other or with anything, being six hours apart and equally audible when
 * wrong. A first attempt grouped this as light-out against dark-out, which permitted "this morning"
 * being called "this afternoon" — coarse enough to miss a whole failure for the sake of one pair.
 *
 * ## What it does not catch, deliberately
 *
 * A script that names no daypart at all, which is the ordinary case and the one the station has no
 * opinion about; and a script that hedges by naming both, which comes back as the first crossing
 * found rather than as a separate verdict, because the answer is the same either way.
 */
export function contradictsDayPart(script: string, part: RoughTime | undefined): string | undefined {
    if (part === undefined) return undefined;

    const told = stretchOf(part.words);
    if (told === undefined) return undefined;

    // Every daypart word naming a different stretch. Matched with `saysTime`'s own
    // case-insensitivity, which exists because a model capitalises the first word of a sentence and
    // a station whose break said "Tonight" had its claim silently dropped for the capital T.
    return DAYPART_WORDS.find(words => stretchOf(words) !== told && saysTime(script, { ...part, words }));
}

/**
 * A time of day the script named that the clock says it cannot be, or `undefined`.
 *
 * ## Why this is not more rows in the daypart table
 *
 * {@link contradictsDayPart} compares which STRETCH two phrasings name, and there are words a stretch
 * cannot describe. "Midday" is the one that was measured: a bulletin opened "welcome to your midday
 * news blast" at half past four in the afternoon, and no version of the stretch question catches it —
 * midday and half past four are both `afternoon`, so an equality check passes it, and giving midday a
 * stretch of its own would then refuse a perfectly good "coming up to midday" at ten past twelve.
 * What is wrong with the live one is not which half of the day it named but how far from noon it was,
 * and that is a WINDOW, which is the shape the rest of this file already uses for everything.
 *
 * ## The table is read and never offered
 *
 * {@link DAYPARTS_ROUND_THE_CLOCK} is both what a writer is TOLD and what the check reads back, which
 * is why a row there has to declare its stretch. {@link TIMES_OF_DAY} is only ever read: nothing
 * hands these words to a model, and adding a row changes no sentence the station will ever say. That
 * is the whole reason it is a second table rather than more rows in the first — the two have opposite
 * obligations, and one list serving both would mean either the station starts saying "teatime" or the
 * check keeps declining to judge it.
 *
 * Answers `undefined` when the slot instant or the zone is missing, on {@link contradictsDayPart}'s
 * own bargain: a break that was never told when it airs is not refused for guessing.
 */
export function namesWrongTimeOfDay(script: string, at: number | undefined, zone: string | undefined): string | undefined {
    if (at === undefined || zone === undefined) return undefined;

    const { hour } = wallClock(at, zone);

    for (const claim of TIMES_OF_DAY) {
        if (holdsAt(hour, claim)) continue;

        const said = claim.words.find(word => saysWholeWord(script, word));
        if (said !== undefined) return said;
    }

    return undefined;
}

/**
 * Words for a time of day, and the hours each one is true in.
 *
 * Deliberately short, and every entry earns its place by being something a model has said or would
 * plainly say. These are not synonyms for the dayparts: each names a POINT in the day with an hour or
 * two either side of it, which is exactly what a stretch cannot express and why they are here.
 *
 * `untilHour` is exclusive and may be smaller than `fromHour`, which is how "midnight" spans the turn
 * of the day; see {@link holdsAt}. The windows are generous on purpose — the cost of one being too
 * narrow is a good break refused, and the failure being caught is a break naming a time of day four
 * hours from the one it airs in.
 */
const TIMES_OF_DAY: readonly { words: readonly string[]; fromHour: number; untilHour: number }[] = [
    { words: ['midday', 'noon', 'lunchtime'], fromHour: 11, untilHour: 14 },
    { words: ['midnight'], fromHour: 23, untilHour: 1 },
    { words: ['breakfast'], fromHour: 5, untilHour: 10 },
    { words: ['teatime'], fromHour: 16, untilHour: 19 },
];

/** Whether an hour falls in a window that may wrap around midnight. */
const holdsAt = (hour: number, window: { fromHour: number; untilHour: number }): boolean =>
    window.fromHour <= window.untilHour
        ? hour >= window.fromHour && hour < window.untilHour
        : hour >= window.fromHour || hour < window.untilHour;

/**
 * Whether a script carries a word, as a word.
 *
 * **{@link saysTime} cannot be used for this and the reason is concrete**: it is `includes`, and
 * `noon` is a substring of `afternoon`. Reusing it would have the station's own daypart phrasing
 * trigger the check against itself on every afternoon break — a guard that refuses the exact words it
 * told the model to use.
 *
 * `matchesDictionMarker` in `personas/persona.sheet.ts` is the same problem solved once already and
 * is worth reading for the boundary it uses. Not imported: a personas helper reaching into the
 * director is the wrong direction, and that one also carries inflections, which a fixed word for a
 * time of day has no use for.
 *
 * Case-insensitive for {@link saysTime}'s reason — a model capitalises the first word of a sentence.
 */
const saysWholeWord = (script: string, word: string): boolean => new RegExp(`(?<![a-z])${word}(?![a-z])`).test(script.toLowerCase());

/**
 * The stretch of the day a phrasing names, as against the phrasing itself.
 *
 * Two words share one of these only where a presenter could honestly use either, which is `night`
 * alone. See {@link contradictsDayPart} for why the question is asked about the stretch rather than
 * about the words.
 */
type DayStretch = 'morning' | 'afternoon' | 'night';

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

    return spanning(at, hour, minute, part);
}

/**
 * When of the day it is, for a writer that has to know without being asked to greet anybody.
 *
 * The sibling of {@link dayGreeting} and deliberately NOT the same list. A greeting has a hole in it
 * on purpose — there is nothing to say to somebody at two in the morning, so `dayGreeting` answers
 * `undefined` and the phrasing drops its chunk — and that hole is exactly the hour a presenter is
 * most likely to want the word "tonight". So this covers all twenty-four, and the small hours get a
 * name of their own rather than an absence.
 *
 * ## The failure it exists for
 *
 * A model was told the time as {@link roughTime} words and nothing else, and those are twelve-hour
 * with no am or pm by design — "just after half past seven" is what a presenter says, and a listener
 * awake at the time already knows which seven it is. A model does not. Measured on this station over
 * one morning: twelve of thirty-nine talk breaks opened on "Tonight", written between seven and ten
 * in the MORNING, and two breaks apart from a welcome that correctly said "good morning". The
 * persona in force listed `tonight` as a diction marker, so the character check was actively
 * rewarding the wrong word.
 *
 * A {@link RoughTime} for {@link dayGreeting}'s reason: the words and how long they hold are one
 * fact, so a break written at ten to noon saying "this morning" can be dropped at hand-over by the
 * machinery that already drops a stale "coming up to three".
 */
export function dayPart(at: number, zone: string): RoughTime {
    const { hour, minute } = wallClock(at, zone);

    // Never undefined: the list below covers the whole clock. Found rather than indexed so the
    // bounds stay written once, in the table.
    const part = DAYPARTS_ROUND_THE_CLOCK.find(daypart => hour >= daypart.from && hour < daypart.until) ?? DAYPARTS_ROUND_THE_CLOCK[0]!;

    return spanning(at, hour, minute, part);
}

/**
 * Every hour of the day, named.
 *
 * The three greeting dayparts with their own wording, plus the gap they leave. "Late at night" runs
 * from ten in the evening to five in the morning as ONE part rather than splitting at midnight,
 * because that is how the hour is spoken about — somebody up at two is having a late night, not an
 * early morning, and a presenter saying "this morning" to them is the same wrongness in the other
 * direction.
 *
 * Phrased as the adverbial a break would actually contain ("this morning", "tonight") rather than as
 * a label ("morning"), because these words are handed to a model to USE and are searched for in what
 * comes back. A label would be told to it and never said.
 *
 * `stretch` is what {@link contradictsDayPart} judges by, and it is on the row rather than in a
 * second list so a part added here cannot be left out of that question. It differs from the words in
 * exactly one place: "this evening" and "tonight" both name `night`, because a presenter at nine may
 * honestly say either and the boundary between them at ten only exists because a table has to put it
 * somewhere.
 */
const DAYPARTS_ROUND_THE_CLOCK: readonly { from: number; until: number; words: string; stretch: DayStretch }[] = [
    // Leads, so the `?? [0]` above lands on the part that actually covers midnight.
    { from: 0, until: 5, words: 'tonight', stretch: 'night' },
    { from: 5, until: 12, words: 'this morning', stretch: 'morning' },
    { from: 12, until: 18, words: 'this afternoon', stretch: 'afternoon' },
    { from: 18, until: 22, words: 'this evening', stretch: 'night' },
    { from: 22, until: 24, words: 'tonight', stretch: 'night' },
];

/**
 * Which stretch a phrasing names, or `undefined` for a word the table does not carry.
 *
 * Read out of {@link DAYPARTS_ROUND_THE_CLOCK} rather than listed again, so a part added to that
 * table has to declare its stretch and cannot quietly fall outside this question. A word belonging
 * to none is one {@link contradictsDayPart} declines to judge — the safe direction, but not one to
 * arrive at by accident.
 *
 * Below the table rather than beside its caller: both of these read it as the module loads, and a
 * `const` above it is in the temporal dead zone when it does.
 */
const stretchOf = (words: string): DayStretch | undefined => DAYPARTS_ROUND_THE_CLOCK.find(daypart => daypart.words === words)?.stretch;

/** Every daypart the station has a word for, once each. */
const DAYPART_WORDS: readonly string[] = [...new Set(DAYPARTS_ROUND_THE_CLOCK.map(daypart => daypart.words))];

/**
 * A daypart as words with the window they hold in, given the hour it was found at.
 *
 * Shared by the two above so the arithmetic exists once. It is the same arithmetic {@link roughTime}
 * uses and for the same reason: every zone offset there is is a whole number of minutes, so the wall
 * clock and the instant agree by construction and neither needs parsing.
 */
function spanning(at: number, hour: number, minute: number, part: { from: number; until: number; words: string }): RoughTime {
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
