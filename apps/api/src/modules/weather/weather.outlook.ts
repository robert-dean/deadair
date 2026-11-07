import type { WeatherCondition } from '@deadair/plugin-sdk';
import type { StationUnits } from './weather.keys.js';
import type { SpokenConditions, SpokenHour, SpokenWeather } from './weather.words.js';

/**
 * The next few hours, as things a station could say about them.
 *
 * Pure, and in the weather module rather than beside a writer, for `weather.words.ts`'s reason:
 * arithmetic that only runs on air is arithmetic nobody checks. It takes a reading already in the
 * station's units and the instant the words will be SPOKEN, and answers with at most one note about
 * precipitation and one about the temperature. Each is a whole sentence, so the floor can say it as
 * written and a model can be shown it rather than a table of hours to do sums on.
 *
 * ## Every distance is measured from when the break airs
 *
 * Never from a row's position. A reading is fetched, cached for a while and then written ahead of its
 * slot, so its first row is routinely an hour or two behind the moment the words are heard, and a note
 * that counted rows would say "in about three hours" about rain that is one hour away. So each row is
 * placed by its own `at`, a row is in the outlook while its period has not ended by `airsAt`, and the
 * window closes {@link OUTLOOK_HOURS} after it.
 *
 * ## "Likely" is a figure, and below it is a possibility, and below that is nothing
 *
 * A row is LIKELY to bring something at {@link LIKELY_CHANCE} or more, and the note then says the
 * chance in digits. From {@link POSSIBLE_CHANCE} up to that it is a POSSIBILITY, in the row's own word
 * and with no figure: "rain possible" is true of a 40% row where "rain likely" is not, and a figure on
 * it invites the presenter to round it up. Under that, nothing is said, because a 10% chance of rain
 * read out is a station forecasting rain. A row that names precipitation with no chance at all (the
 * National Weather Service leaves a share of its hours null) is a possibility, which says what the
 * service said without a figure it did not give.
 *
 * ## A dry sky with a high chance keeps its sky
 *
 * Services disagree with themselves: a row's code says cloudy and its chance says seventy. The chance
 * is what a listener cares about, so at {@link LIKELY_CHANCE} it is said, but the row is never
 * described as raining, since the code says it is not. The precipitation is named from the row's
 * temperature, snow at or below freezing and rain above, and a row with no temperature says nothing,
 * because guessing between the two is guessing. Below that chance a dry row says nothing either: a
 * clear sky with a 35% chance is not "rain possible".
 *
 * ## Only measured figures are digits
 *
 * Times are in words ("in about three hours", "by midnight") so that every digit in a note is a figure
 * the service reported, which is what lets `inventedFigure` check a script that used one. A
 * temperature note names its unit, because "down to 4 by midnight" is a sentence a listener has to
 * guess the scale of, and it is only made for a swing of {@link SWING} in the station's own units:
 * a degree or two over an evening is not news.
 */

/** How far past the moment the break airs the outlook looks. "The next few hours", as a number. */
export const OUTLOOK_HOURS = 6;

/** The chance at which precipitation is "likely", and said with its figure. */
export const LIKELY_CHANCE = 50;

/** The chance at which precipitation is "possible", and said without one. Below it, nothing. */
export const POSSIBLE_CHANCE = 30;

/** How far the temperature must move inside the window to be worth a note, per unit. */
export const SWING: Readonly<Record<StationUnits, number>> = { metric: 5, imperial: 8 };

/** How sure the outlook is about precipitation. */
export type OutlookBand = 'likely' | 'possible';

/** One thing worth saying about the next few hours. */
export interface OutlookNote {
    /** What it is about. */
    kind: 'precipitation' | 'temperature';
    /** The precipitation (`rain`, `snow`, `thunderstorms` and so on), or `down` or `up` for the temperature. */
    word: string;
    /** For precipitation, how sure. For the temperature always `swing`. */
    band: OutlookBand | 'swing';
    /** When the row it is about begins, as the plugin gave it, with the place's offset. */
    at: string;
    /** The sentence, capitalised and stopped, in the station's units. */
    text: string;
}

const HOUR_MS = 3_600_000;

/**
 * The rows of a reading's outlook that are still ahead of, or under way at, `airsAt`, and start no
 * later than {@link OUTLOOK_HOURS} after it.
 *
 * A row's period runs until the next row begins, so a three-hourly row that started two hours before
 * the break is still the one in force. The last row is taken to run as long as the one before it, or
 * an hour when it is the only one.
 */
export function outlookWindow(weather: SpokenWeather, airsAt: number): SpokenHour[] {
    const rows = (weather.hours ?? [])
        .map(hour => ({ hour, start: Date.parse(hour.at) }))
        .filter(row => Number.isFinite(row.start))
        .sort((a, b) => a.start - b.start);

    const kept: SpokenHour[] = [];
    for (const [index, row] of rows.entries()) {
        const next = rows[index + 1]?.start;
        const previous = rows[index - 1]?.start;
        const end = next ?? row.start + (previous === undefined ? HOUR_MS : row.start - previous);
        if (end <= airsAt || row.start > airsAt + OUTLOOK_HOURS * HOUR_MS) continue;
        kept.push(row.hour);
    }

    return kept;
}

/**
 * What is worth saying about the next few hours, precipitation first, or an empty list.
 *
 * @param weather - A reading in the station's units, with its outlook.
 * @param airsAt - When the words will be heard, as epoch millis. Every distance is from here.
 */
export function outlookNotes(weather: SpokenWeather, airsAt: number): OutlookNote[] {
    const window = outlookWindow(weather, airsAt);
    if (window.length === 0) return [];

    const notes: OutlookNote[] = [];
    const precipitation = precipitationNote(weather, window, airsAt);
    if (precipitation !== undefined) notes.push(precipitation);
    const temperature = temperatureNote(weather, window, airsAt);
    if (temperature !== undefined) notes.push(temperature);
    return notes;
}

/** The precipitation a row stands for, and how sure it is, or `undefined` when it says none. */
function precipitationOf(row: SpokenConditions, units: StationUnits): { word: string; band: OutlookBand; chance?: number } | undefined {
    const chance = row.precipitationChance;
    const wet = WET_WORDS[row.condition];

    if (wet !== undefined) {
        if (chance === undefined) return { word: wet, band: 'possible' };
        if (chance >= LIKELY_CHANCE) return { word: wet, band: 'likely', chance };
        if (chance >= POSSIBLE_CHANCE) return { word: wet, band: 'possible' };
        return undefined;
    }

    // A dry code: only a chance that is likely is said, and named from the temperature.
    if (chance === undefined || chance < LIKELY_CHANCE || row.temperature === undefined) return undefined;
    return { word: row.temperature <= FREEZING[units] ? 'snow' : 'rain', band: 'likely', chance };
}

/**
 * The first row in the window that is likely to bring something, or the first that might.
 *
 * Likely is preferred over sooner, so a 40% hour followed by a 90% one says the 90%: the possibility
 * in front of a near-certainty is the less useful sentence. Nothing is said when it is already
 * coming down, because "rain likely within the hour" in the rain is a station not looking out of the
 * window.
 */
function precipitationNote(weather: SpokenWeather, window: readonly SpokenHour[], airsAt: number): OutlookNote | undefined {
    if (WET_WORDS[weather.current.condition] !== undefined) return undefined;

    const read = window.map(hour => ({ hour, said: precipitationOf(hour, weather.units) }));
    const chosen = read.find(row => row.said?.band === 'likely') ?? read.find(row => row.said?.band === 'possible');
    if (chosen?.said === undefined) return undefined;

    const { word, band, chance } = chosen.said;
    const when = hoursAway(Date.parse(chosen.hour.at), airsAt);
    const text =
        band === 'likely' && chance !== undefined
            ? `${capitalise(word)} likely ${when}, ${article(chance)} ${chance}% chance.`
            : `${capitalise(word)} possible ${when}.`;

    return { kind: 'precipitation', word, band, at: chosen.hour.at, text };
}

/**
 * The biggest move in temperature between now and the end of the window, when it is a swing.
 *
 * Measured from the row in force when the break airs, or the current figure where there is none,
 * to the lowest and highest rows that begin after it. A fall wins a tie, since the evening chill is
 * the one a listener acts on.
 */
function temperatureNote(weather: SpokenWeather, window: readonly SpokenHour[], airsAt: number): OutlookNote | undefined {
    const inForce = window.filter(hour => Date.parse(hour.at) <= airsAt).at(-1);
    const base = inForce?.temperature ?? weather.current.temperature;
    if (base === undefined) return undefined;

    const ahead = window.filter(hour => Date.parse(hour.at) > airsAt && hour.temperature !== undefined);
    if (ahead.length === 0) return undefined;

    const lowest = ahead.reduce((low, hour) => (hour.temperature! < low.temperature! ? hour : low));
    const highest = ahead.reduce((high, hour) => (hour.temperature! > high.temperature! ? hour : high));
    const fall = base - lowest.temperature!;
    const rise = highest.temperature! - base;
    const threshold = SWING[weather.units];

    const unit = weather.units === 'imperial' ? 'Fahrenheit' : 'Celsius';
    if (fall >= threshold && fall >= rise) {
        return {
            kind: 'temperature',
            word: 'down',
            band: 'swing',
            at: lowest.at,
            text: `Down to ${lowest.temperature} degrees ${unit} ${byClock(lowest.at)}.`,
        };
    }
    if (rise >= threshold) {
        return {
            kind: 'temperature',
            word: 'up',
            band: 'swing',
            at: highest.at,
            text: `Up to ${highest.temperature} degrees ${unit} ${byClock(highest.at)}.`,
        };
    }
    return undefined;
}

/**
 * A note as the next break compares it: what it is about, how sure, and the hour it is about.
 *
 * Not the sentence. "In about three hours" said at noon and "in about two hours" said at one are the
 * same rain, and a key that held the words would call them different news. So it holds the parts
 * that do not move with the clock, and the hour the note is ABOUT, rounded to the place's own hour.
 */
export interface OutlookKey {
    kind: OutlookNote['kind'];
    word: string;
    band: OutlookNote['band'];
    /** The hour the note is about, rounded to the place's local hour, as an ISO-8601 instant in UTC. */
    onset: string;
}

/** What a weather break stamps on its row: the place its outlook was for, and the notes it covered. */
export interface OutlookSaid {
    place: string;
    notes: OutlookKey[];
}

/**
 * How far an onset may move and still be the same news. An hour: a forecast for rain at three that
 * now says four has not told anybody anything new, and one that says six has.
 */
export const SAME_ONSET_MS = HOUR_MS;

/** A note's key. See {@link OutlookKey}. */
export function keyOf(note: OutlookNote): OutlookKey {
    return { kind: note.kind, word: note.word, band: note.band, onset: new Date(localHour(note.at)).toISOString() };
}

/** Whether two keys are the same news: everything equal, and onsets no more than an hour apart. */
export function sameNews(a: OutlookKey, b: OutlookKey): boolean {
    const apart = Math.abs(Date.parse(a.onset) - Date.parse(b.onset));
    return a.kind === b.kind && a.word === b.word && a.band === b.band && Number.isFinite(apart) && apart <= SAME_ONSET_MS;
}

/**
 * The notes the last weather break about this place did not already cover, and what this break is to
 * stamp.
 *
 * The stamp is everything known said: this break's new notes, plus the previous break's keys that
 * matched one of this break's notes, kept AS THEY WERE. Carrying the old key rather than the new one
 * is what stops an onset creeping an hour a break from never being news again, since every comparison
 * is against the hour it was first given for. A previous key that matched nothing is the news having
 * gone away and is dropped, so the same rain returning later is said again.
 *
 * @param previous - What the last weather break stamped, or `undefined` when there was none or it was
 *   for somewhere else.
 */
export function unsaid(notes: readonly OutlookNote[], place: string, previous: OutlookSaid | undefined): { fresh: OutlookNote[]; said: OutlookSaid } {
    const before = previous?.place === place ? previous.notes : [];
    const fresh: OutlookNote[] = [];
    const stamped: OutlookKey[] = [];

    for (const note of notes) {
        const key = keyOf(note);
        const covered = before.find(old => sameNews(old, key));
        if (covered === undefined) fresh.push(note);
        stamped.push(covered ?? key);
    }

    return { fresh, said: { place, notes: stamped } };
}

/**
 * A stamp read back off a row, or `undefined` for anything without the shape.
 *
 * A JSON column is text anything could have written, so every field is checked rather than cast, and a
 * note that does not read is dropped rather than failing the whole stamp.
 */
export function outlookSaidOf(value: unknown): OutlookSaid | undefined {
    const parsed = typeof value === 'string' ? safeParse(value) : value;
    if (parsed === null || typeof parsed !== 'object') return undefined;

    const { place, notes } = parsed as { place?: unknown; notes?: unknown };
    if (typeof place !== 'string' || !Array.isArray(notes)) return undefined;

    const keys = notes.filter(
        (note): note is OutlookKey =>
            note !== null &&
            typeof note === 'object' &&
            (note.kind === 'precipitation' || note.kind === 'temperature') &&
            typeof note.word === 'string' &&
            typeof note.band === 'string' &&
            typeof note.onset === 'string',
    );
    return { place, notes: keys };
}

const safeParse = (text: string): unknown => {
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
};

/**
 * An instant rounded to the nearest hour on the place's own clock, as epoch millis.
 *
 * Rounded on the wall clock written in the string rather than on UTC, which differ for a place whose
 * offset is a half hour: a row at 10:00 in Mumbai is on its hour and not on UTC's.
 */
function localHour(at: string): number {
    const ms = Date.parse(at);
    const clock = /T\d{2}:(\d{2}):?(\d{2})?/.exec(at);
    if (!Number.isFinite(ms) || clock === null) return ms;

    const intoHour = Number(clock[1]) * 60_000 + Number(clock[2] ?? 0) * 1_000;
    const floor = ms - intoHour;
    return intoHour >= HOUR_MS / 2 ? floor + HOUR_MS : floor;
}

/** "within the hour", "in about an hour", "in about three hours". Rounded to the nearest hour. */
export function hoursAway(at: number, airsAt: number): string {
    const hours = Math.round((at - airsAt) / HOUR_MS);
    if (hours <= 0) return 'within the hour';
    if (hours === 1) return 'in about an hour';
    return `in about ${NUMBER_WORDS[hours] ?? 'several'} hours`;
}

/**
 * "by midnight", "by nine this evening", "by three in the morning", from the wall clock written in
 * the row's own `at`.
 *
 * Read off the string rather than through a timezone, because the plugin already wrote the place's
 * clock there with its offset: that is what the capability's offset rule is for. Rounded to the
 * nearest hour. The window is six hours, so "this afternoon" and "this evening" cannot be tomorrow's;
 * an hour after midnight is "in the morning" with no "this", which is how anybody says it.
 */
export function byClock(at: string): string {
    const clock = /T(\d{2}):(\d{2})/.exec(at);
    if (clock === null) return 'later';

    const hour = (Number(clock[1]) + (Number(clock[2]) >= 30 ? 1 : 0)) % 24;
    if (hour === 0) return 'by midnight';
    if (hour === 12) return 'by midday';
    if (hour < 12) return `by ${NUMBER_WORDS[hour]} in the morning`;
    if (hour < 18) return `by ${NUMBER_WORDS[hour - 12]} this afternoon`;
    return `by ${NUMBER_WORDS[hour - 12]} this evening`;
}

/** The noun each wet condition is said as. Absent for the dry ones. */
const WET_WORDS: Partial<Record<WeatherCondition, string>> = {
    drizzle: 'drizzle',
    rain: 'rain',
    snow: 'snow',
    sleet: 'sleet',
    thunderstorm: 'thunderstorms',
    hail: 'hail',
};

/** Freezing, in each unit. At or below it a dry row's precipitation is snow. */
const FREEZING: Readonly<Record<StationUnits, number>> = { metric: 0, imperial: 32 };

const NUMBER_WORDS: readonly string[] = [
    'zero',
    'one',
    'two',
    'three',
    'four',
    'five',
    'six',
    'seven',
    'eight',
    'nine',
    'ten',
    'eleven',
    'twelve',
    'thirteen',
    'fourteen',
    'fifteen',
    'sixteen',
    'seventeen',
    'eighteen',
    'nineteen',
    'twenty',
    'twenty-one',
    'twenty-two',
    'twenty-three',
    'twenty-four',
];

/** "an 80% chance", "an 18% chance", "a 60% chance": the article goes with the figure as it is said. */
const article = (figure: number): string => (/^8|^1[18]$/.test(String(figure)) ? 'an' : 'a');

const capitalise = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);
