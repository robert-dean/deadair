import type { WeatherCondition } from '@deadair/plugin-sdk';
import type { SpokenWeather } from '#modules/weather/weather.words.js';
import { germanFigures } from './german.numbers.js';

/**
 * What a script said about the sky, judged against the reading it was written from.
 *
 * Two questions, and they are deliberately in one file rather than on either writer. `inventedFigure`
 * began in `model.weather.break.writer.ts` and could stay there for as long as the weather break was
 * the only kind that reported a measurement; the talk break reporting one too makes that the wrong
 * home, because the alternative is one peer writer importing from another under the same registry.
 * They are siblings behind `BreakWriterRegistry`, not a chain, and an edge between them would be the
 * first.
 *
 * Both are pure and take the reading as an argument, so neither needs DI and both are testable
 * without a model, a plugin or a station. That is the property that matters: arithmetic and matching
 * that only run on air are arithmetic and matching nobody checks.
 *
 * ## The two are asked by different kinds for opposite reasons
 *
 * A weather break asks {@link inventedFigure} alone, because `WEATHER_SHAPE` exists to make the model
 * state the reading and a break that reached the guard reported it by definition.
 *
 * A talk break asks both, because there the reading is OFFERED and most breaks will decline it. What
 * it did with the figures is still checkable the same way; whether it said anything at all is a new
 * question, and {@link mentionsWeather} is the only thing standing between a break that never
 * mentioned the weather and a `claims_reading_until` stamp that would have `brokenClaim` reopen it
 * for a claim it never made.
 */

/**
 * The first number in the script that the station was not given, or `undefined` when every one of
 * them was measured.
 *
 * The whole of the weather path's safety property, and the reason a model may report a measurement at
 * all: unlike a paraphrased news story, a forecast's claims ARE its numbers, and the set of true ones
 * is known exactly. So a script saying "twenty-two" when the service said seventeen is refusable with
 * certainty, where "the council said it would look into it" is not.
 *
 * Three things about how it judges are deliberate.
 *
 * **Digits are checked everywhere, and words only in German.** A model writing "seventeen" has said a
 * true thing and a model writing "22" has not, and catching the spelled-out form in every language
 * would mean a number vocabulary in eleven of them. English models report a figure in digits, so an
 * English break that spells one out still gets through. A German one does not: `gemma4` wrote
 * "zwanzig Kilometer pro Stunde" off a reading of 12 in a quarter of its breaks, so a German number
 * word that is a measurement (one with a unit after it, one end of such a range, or one with a sign
 * said in words) is read and compared exactly as a digit is. See `german.numbers.ts` for why a word
 * with no unit is still left alone.
 *
 * **The permitted set is every figure in the reading**, not only the ones the prompt emphasised: the
 * humidity, each day's high and low, each hour of the outlook, and the percentages. A model that mentioned the humidity when
 * the prompt did not ask it to has said something true, and refusing that would push it toward
 * saying less than it knows rather than more than it was told.
 *
 * **A year, a clock time and an ordinal are not figures.** `2026`, `9:30` and `1st` all appear in
 * ordinary speech about the weather and none of them is a measurement, so a number attached to a
 * colon or a date-shaped run is left alone. The station's other guards already own what a script may
 * claim about the time.
 *
 * **A hyphen after a digit or a letter is not a minus.** "3-5 degrees" is a range and "mid-30s" is a
 * figure of 30, and both ends are still checked.
 *
 * **A minus is as often a word as a mark, and only English and German have their words read.** "minus
 * 5", "negative 5" and "5 below" are -5 in English, "minus 5" and "minus fünf" are -5 in German, and a
 * bare 5 is a 5, so a reading of -5 refuses "5 degrees" and a reading of 5 refuses "minus 5". "5 below
 * average" reads as -5 too, which costs nothing: a weather break may not compare, and either answer
 * refuses or passes a comparison nobody measured.
 *
 * Outside those two the word for minus is not read, so a figure with no sign in its digits stands for a
 * reading of 5 or of -5, and only "-5" has to be exactly that. That is also true of a German figure with
 * no sign at all: "5 Grad" passes a reading of -5 everywhere but English. What it costs is the sign not
 * said, which a model below freezing does routinely, and refusing it refused every true figure below
 * freezing on a station whose only fallback is to drop the break (discussion 868).
 */
export function inventedFigure(script: string, weather: SpokenWeather, language?: string): string | undefined {
    const measured = measuredFigures(weather);

    // A clock time, a date and a year are removed before anything is read as a measurement. The
    // station's other guards own what a script may claim about the time; this one owns the figures.
    for (const said of statedFigures(withoutTimes(script, language), language)) {
        if (!Number.isFinite(said.value) || isMeasured(said, measured, language)) continue;
        return said.text;
    }

    return undefined;
}

/**
 * Whether this script actually reported the reading it was offered.
 *
 * Asked by the kind that may IGNORE the weather, which is every kind but the weather break, and the
 * answer decides whether the break is stamped with `claims_reading_until`. Getting it wrong in either
 * direction costs something real, and they are not symmetrical:
 *
 * - **A false yes** stamps a break that said nothing about the sky, and `brokenClaim` then reopens it
 *   — and eventually drops it at hand-over — over a claim it never made. The break was fine.
 * - **A false no** airs a sentence about the weather with no shelf life on it, which is the station
 *   saying this morning's conditions at teatime. That is the failure `claims_reading_until` exists
 *   for.
 *
 * So it leans toward YES, and the two tests below are `or` rather than `and`: a figure the reading
 * carried, or a word for what the sky is doing. Either alone is a break talking about the weather.
 *
 * **The figure test is `inventedFigure`'s set read the other way round.** By the time this is asked
 * every number in the script has already been checked against the reading, so a number still present
 * is one the service measured — and a break that said a measured number said the weather. That
 * sequencing is why this does not re-derive anything: it is the same `measuredFigures` set, asked
 * "did it use one" instead of "did it use something else".
 *
 * **The word test is a vocabulary per CONDITION, not the reading's own adjective**, and that
 * distinction is the whole of why this is not a one-line `includes`. `conditionWords` answers
 * `clear`, and the sentence this feature exists to permit is "It's sunny today, get out there and
 * tan" — so a test that looked for the word the prompt showed would answer NO for the example the
 * feature was built from, and leave exactly the break that reported the sky unstamped. What a
 * presenter says is not what a service measured, which is `weather.words.ts`'s own argument one step
 * further out: the adjective is the station's word for the reading, and the synonyms below are the
 * listener's.
 *
 * The service's own `description` is deliberately NOT matched — it is frequently a phrase like
 * "light intensity shower rain" that no presenter says, and matching on it would answer no for every
 * break that put it in ordinary English.
 *
 * What this cannot catch is a break that reported the sky in words no list anticipated — "you can see
 * your breath out there" off a reading that said `clear` and 2 degrees. It answers no, the break airs
 * unstamped, and the exposure is one talk break with a soft claim in it. That is the deliberate
 * floor: the alternative is asking a model to tell us what it just did, which is the check that
 * approves its own work.
 */
export function mentionsWeather(script: string, weather: SpokenWeather, language?: string): boolean {
    // The vocabulary below is English, so outside English a break offered a reading is taken to have
    // reported it. That is the false yes above, chosen on purpose: it costs a break that said nothing
    // about the sky a claim it did not make, where the false no would air a stale reading.
    if (language !== undefined) return true;

    const said = script.toLowerCase();

    // The place first, because it is the cheapest and the most certain: a talk break has no other
    // reason to name the town the reading is about.
    if (weather.place.trim().length > 0 && said.includes(weather.place.trim().toLowerCase())) return true;

    for (const word of conditionVocabulary(weather)) {
        if (said.includes(word)) return true;
    }

    // Read against the SAME text `inventedFigure` judged, so a year or a clock time cannot be read as
    // a measurement here having been excluded there.
    const measured = measuredFigures(weather);
    for (const said of statedFigures(withoutTimes(script))) {
        if (Number.isFinite(said.value) && isMeasured(said, measured)) return true;
    }

    return false;
}

/** A number as a script wrote it, and as the station compares it. */
interface StatedFigure {
    text: string;
    /** Where it sits in the script, so figures read two ways are still named in the order they were said. */
    index: number;
    value: number;
    /** Whether it says which side of zero it is on, in its digits or, in English and German, in words. */
    signed: boolean;
}

/**
 * Every number in a script, rounded as {@link measuredFigures} rounds them.
 *
 * Shared by both questions for the same reason as {@link withoutTimes}. Outside English a decimal is
 * as likely to be written with a comma as a point: "17,5 Grad" is one figure, and read as two it is a
 * 5 nobody measured. U+2212 is the minus a model writes when it is being careful about typography.
 * On a German station the figures said in words are read beside the digits (`german.numbers.ts`).
 */
function statedFigures(script: string, language?: string): StatedFigure[] {
    const digits = [...script.matchAll(figurePattern(language))].map(match => {
        const text = match[0];
        const number = /\d+(?:[.,]\d+)?/.exec(text)?.[0] ?? '';
        const negative = !/^\d/.test(text) || /below$/i.test(text);
        return { text, index: match.index, signed: negative, value: Math.round(Number(number.replace(',', '.')) * (negative ? -1 : 1)) };
    });
    if (!readsGerman(language)) return digits;

    const words = germanFigures(script).map(figure => ({ ...figure, value: Math.round(figure.value) }));
    return [...digits, ...words].sort((a, b) => a.index - b.index);
}

/** Whether the station's language is German, in any of its regional tags. */
const readsGerman = (language?: string): boolean => language?.toLowerCase().split(/[-_]/)[0] === 'de';

/** A minus sign, which a hyphen straight after a letter or a digit is not. */
const MINUS_SIGN = '(?<![\\p{L}\\p{N}])[-\\u2212]';
const ENGLISH_FIGURE = new RegExp(`(?:${MINUS_SIGN}|\\b(?:minus|negative)\\s+)?\\d+(?:\\.\\d+)?(?:\\s+(?:degrees?\\s+)?below\\b)?`, 'giu');
const GERMAN_FIGURE = new RegExp(`(?:${MINUS_SIGN}|(?<!\\p{L})minus\\s+)?\\d+(?:[.,]\\d+)?`, 'giu');
const OTHER_FIGURE = new RegExp(`(?:${MINUS_SIGN})?\\d+(?:[.,]\\d+)?`, 'gu');

const figurePattern = (language?: string): RegExp => (language === undefined ? ENGLISH_FIGURE : readsGerman(language) ? GERMAN_FIGURE : OTHER_FIGURE);

/** Whether the reading carried this figure. See {@link inventedFigure} on what a missing sign means. */
const isMeasured = ({ value, signed }: StatedFigure, measured: ReadonlySet<number>, language?: string): boolean =>
    measured.has(value) || (language !== undefined && !signed && measured.has(-value));

/**
 * Every figure the service actually reported, rounded as the station says them.
 *
 * Rounded because `weather.words.ts` already rounds on the way out — nobody has ever heard a station
 * announce 17.4 degrees — so the set and the script are compared in the same form.
 */
function measuredFigures(weather: SpokenWeather): Set<number> {
    const measured = new Set<number>();
    const keep = (value: number | undefined): void => {
        if (value !== undefined) measured.add(Math.round(value));
    };

    keep(weather.current.temperature);
    keep(weather.current.feelsLike);
    keep(weather.current.wind);
    keep(weather.current.humidity);
    keep(weather.current.precipitationChance);

    for (const day of weather.days ?? []) {
        keep(day.high);
        keep(day.low);
        keep(day.temperature);
        keep(day.wind);
        keep(day.humidity);
        keep(day.precipitationChance);
    }

    // The hourly outlook, which `WeatherSource` has already cut to the window the break was shown, so
    // a figure from an hour nobody was told about is still refused. Every digit in an outlook note
    // (`weather.outlook.ts`) is one of these, since its times are written in words.
    for (const hour of weather.hours ?? []) {
        keep(hour.temperature);
        keep(hour.feelsLike);
        keep(hour.wind);
        keep(hour.humidity);
        keep(hour.precipitationChance);
    }

    return measured;
}

/**
 * The script with everything that is a time rather than a measurement taken out.
 *
 * Shared by both questions above so they cannot disagree about which runs of digits are figures at
 * all. See {@link inventedFigure}'s third note.
 */
const withoutTimes = (script: string, language?: string): string => {
    const english = script
        .replace(/\d{1,2}:\d{2}/g, ' ')
        .replace(/\b\d{1,2}(?:st|nd|rd|th)\b/gi, ' ')
        .replace(/\b(?:19|20)\d{2}\b/g, ' ');
    if (language === undefined) return english;

    // The other ways a time and a date are written: `21.30` and `21h30`, and the ordinal that is a
    // number and a full stop, `am 24. September`. Each of them was a figure the reading never had.
    return english.replace(/\b\d{1,2}[.h]\d{2}\b/g, ' ').replace(/\b\d{1,2}\.(?=\s)/g, ' ');
};

/**
 * What a script reported about the weather when it was given no reading at all, or `undefined`.
 *
 * The third question in this file and the strict sibling of {@link mentionsWeather}. That one leans
 * toward yes because a false yes there costs nothing; here a yes REFUSES a break, so the list is the
 * opposite kind: whole words only, and only the ones nobody says about anything but the sky. `storm`
 * goes (a record takes the charts by storm), `grey` and `clear` go (a mood, a choice), `rain` goes as
 * a bare noun (rain or shine). What stays is a presenter describing the weather outside: sunny,
 * raining, overcast, a downpour, and a temperature in degrees.
 *
 * Read against a script with the record names already taken out by the caller, so "Sunny" and
 * "Here Comes The Rain Again" are titles rather than claims.
 *
 * English only, like the vocabulary it sits beside: outside English it answers `undefined` rather
 * than refusing a break for a word list it cannot read.
 */
export function unofferedWeather(script: string, language?: string): string | undefined {
    if (language !== undefined) return undefined;

    return WEATHER_CLAIM.exec(script)?.[0];
}

/**
 * The words a presenter only uses about the weather outside, as whole words, plus a figure in
 * degrees. A figure here is a claim by itself: with no reading behind it, any temperature is made up.
 *
 * Several obvious words are missing on purpose, each because ordinary speech about records uses it
 * for something else, and a refusal over trivia is the expensive direction of error here. `sunshine`
 * is a term of address and a metaphor ("hello, sunshine", "a ray of sunshine", sunshine pop).
 * `stormy` is the usual word for a band's relationships. `chilly` and `frosty` are how a record's
 * reception gets described. `showers` is praise as often as rain, `freezing` is somebody in the studio
 * and `misty` is misty-eyed. `windy` stays, but not in front of "city", which is Chicago.
 */
const WEATHER_WORDS = [
    'sunny',
    'raining',
    'rainy',
    'drizzle',
    'drizzly',
    'drizzling',
    'downpours?',
    'snowing',
    'snowy',
    'snowfall',
    'foggy',
    'overcast',
    'cloudy',
    'thunderstorms?',
    'sleet',
    'sleeting',
    'hailstorms?',
    'blue skies',
    'clear skies',
    'gr[ae]y skies',
    String.raw`windy(?!\s+city)`,
    'gusty',
    'blustery',
    'humid',
    'muggy',
    'heatwaves?',
    'rainfall',
    String.raw`pouring\s+(?:down|with\s+rain)`,
    String.raw`scattered\s+showers`,
];

const WEATHER_CLAIM = new RegExp(String.raw`\b(?:${WEATHER_WORDS.join('|')})\b|-?\b\d+\s*(?:°|degrees?\b)`, 'i');

/** Every word that would count as reporting this reading's sky, across the conditions it names. */
function conditionVocabulary(weather: SpokenWeather): string[] {
    const conditions = [
        weather.current.condition,
        ...(weather.days ?? []).map(day => day.condition),
        ...(weather.hours ?? []).map(hour => hour.condition),
    ];

    return conditions.flatMap(condition => CONDITION_VOCABULARY[condition]);
}

/**
 * What a presenter might say for each thing the sky can be doing.
 *
 * The listener's half of `CONDITION_WORDS` in `weather.words.ts`, which holds the station's own
 * adjective for each condition. This is deliberately the LOOSER list of the two, and the reason is
 * the asymmetry stated on {@link mentionsWeather}: a word missing from here costs a break its stamp,
 * while a word too many costs nothing at all, because a talk break that used one of these words and
 * was not talking about the weather still carries a reading whose expiry is hours away.
 *
 * Every entry is a fragment matched inside the script rather than a whole word, so the noun, the
 * adjective and the participle are all reached by one string: `rain` finds "rain", "raining",
 * "rainy" and "rains". That is also why nothing here is shorter than four characters — `sun` would
 * match inside "Sunday" and "sunk", and a false yes on a break that named a day of the week is the
 * one direction of error that costs a break. `sunny` and `sunshine` carry that condition instead.
 */
const CONDITION_VOCABULARY: Record<WeatherCondition, readonly string[]> = {
    // The one the feature was built from: a `clear` reading and a presenter saying "sunny".
    clear: ['clear', 'sunny', 'sunshine', 'blue sky', 'blue skies'],
    cloudy: ['cloud', 'grey sky', 'gray sky', 'overcast'],
    overcast: ['overcast', 'cloud', 'grey', 'gray', 'gloom'],
    fog: ['foggy', 'fog ', 'mist', 'murk'],
    drizzle: ['drizzl', 'spitting', 'damp'],
    rain: ['rain', 'wet ', 'shower', 'downpour', 'pouring'],
    snow: ['snow', 'blizzard'],
    sleet: ['sleet', 'slush'],
    thunderstorm: ['thunder', 'storm', 'lightning'],
    hail: ['hail'],
};
