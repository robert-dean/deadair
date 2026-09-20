import type { WeatherCondition } from '@deadair/plugin-sdk';
import type { SpokenWeather } from '#modules/weather/weather.words.js';

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
 * **Only digits are checked, not words.** A model writing "seventeen" has said a true thing and a
 * model writing "22" has not, and catching the spelled-out form would mean a number vocabulary in
 * eleven languages to catch a shape no model actually produces — every captured break that reported
 * a figure reported it in digits. What it costs is an invented figure spelled out, which is a real
 * gap and a much smaller one than refusing "seventeen degrees" for not being in the list.
 *
 * **The permitted set is every figure in the reading**, not only the ones the prompt emphasised: the
 * humidity, each day's high and low, and the percentages. A model that mentioned the humidity when
 * the prompt did not ask it to has said something true, and refusing that would push it toward
 * saying less than it knows rather than more than it was told.
 *
 * **A year, a clock time and an ordinal are not figures.** `2026`, `9:30` and `1st` all appear in
 * ordinary speech about the weather and none of them is a measurement, so a number attached to a
 * colon or a date-shaped run is left alone. The station's other guards already own what a script may
 * claim about the time.
 */
export function inventedFigure(script: string, weather: SpokenWeather): string | undefined {
    const measured = measuredFigures(weather);

    // A clock time, a date and a year are removed before anything is read as a measurement. The
    // station's other guards own what a script may claim about the time; this one owns the figures.
    const figures = withoutTimes(script);

    for (const match of figures.matchAll(/-?\d+(?:\.\d+)?/g)) {
        const said = Math.round(Number(match[0]));
        if (!Number.isFinite(said) || measured.has(said)) continue;
        return match[0];
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
export function mentionsWeather(script: string, weather: SpokenWeather): boolean {
    const said = script.toLowerCase();

    // The place first, because it is the cheapest and the most certain: a talk break has no other
    // reason to name the town the reading is about.
    if (weather.place.trim().length > 0 && said.includes(weather.place.trim().toLowerCase())) return true;

    for (const word of conditionVocabulary(weather)) {
        if (said.includes(word)) return true;
    }

    // Read against the SAME text `inventedFigure` judged, so a year or a clock time cannot be read as
    // a measurement here having been excluded there.
    for (const match of withoutTimes(script).matchAll(/-?\d+(?:\.\d+)?/g)) {
        const figure = Math.round(Number(match[0]));
        if (Number.isFinite(figure) && measuredFigures(weather).has(figure)) return true;
    }

    return false;
}

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

    return measured;
}

/**
 * The script with everything that is a time rather than a measurement taken out.
 *
 * Shared by both questions above so they cannot disagree about which runs of digits are figures at
 * all. See {@link inventedFigure}'s third note.
 */
const withoutTimes = (script: string): string =>
    script
        .replace(/\d{1,2}:\d{2}/g, ' ')
        .replace(/\b\d{1,2}(?:st|nd|rd|th)\b/gi, ' ')
        .replace(/\b(?:19|20)\d{2}\b/g, ' ');

/** Every word that would count as reporting this reading's sky, across the conditions it names. */
function conditionVocabulary(weather: SpokenWeather): string[] {
    const conditions = [weather.current.condition, ...(weather.days ?? []).map(day => day.condition)];

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
