// The two questions a break's script is asked about the reading it was written from.
//
// `inventedFigure` moved here from the weather writer's own test when the talk break started
// reporting a measurement too: it is no longer one kind's check, and a test living beside one of two
// callers reads as though the other one is exempt.
//
// `mentionsWeather` is new and is the talk break's alone. The weather break never asks it, because
// `WEATHER_SHAPE` exists to make the model state the reading and a break that reached the guard
// reported it by definition. On the talk break the reading is OFFERED and most breaks decline it, so
// whether the script said anything at all is what decides the `claims_reading_until` stamp.

import { describe, expect, it } from 'vitest';

import { inventedFigure, mentionsWeather } from '../../../src/modules/director/weather.figures.js';
import type { SpokenWeather } from '../../../src/modules/weather/weather.words.js';

const READING: SpokenWeather = {
    place: 'Atlanta',
    observedAt: '2026-08-29T09:00:00-04:00',
    units: 'metric',
    current: { condition: 'rain', words: 'raining', temperature: 17, wind: 20, humidity: 72 },
    days: [{ date: '2026-08-29', condition: 'clear', words: 'clear', high: 24, low: 12, precipitationChance: 40 }],
};

/** The reading behind the sentence this whole feature was asked for: a clear sky, and a host saying "sunny". */
const SUNNY: SpokenWeather = {
    place: 'Atlanta',
    observedAt: '2026-08-29T09:00:00-04:00',
    units: 'metric',
    current: { condition: 'clear', words: 'clear', temperature: 26 },
};

describe('inventedFigure', () => {
    it('permits every figure in the reading, not only the ones the prompt emphasised', () => {
        // A model that mentioned the humidity has said something true, and refusing it would push it
        // toward saying less than it knows.
        expect(inventedFigure('17 degrees, wind 20, humidity 72, high 24, low 12, 40 per cent chance.', READING)).toBeUndefined();
    });

    it('names the first figure that was not measured', () => {
        expect(inventedFigure("It's 17 now and 31 by the weekend.", READING)).toBe('31');
    });

    it('lets a spelled-out number through, which is the gap it deliberately has', () => {
        // Catching the spelled-out form would mean a number vocabulary in eleven languages to catch
        // a shape no model actually produces. Stated as a test so it is a decision rather than a bug.
        expect(inventedFigure("It's thirty-one degrees out there.", READING)).toBeUndefined();
    });

    it('is not fooled by a clock time, a date or a year', () => {
        // None of those is a measurement, and all three turn up in ordinary speech about the weather.
        expect(inventedFigure('Sunrise was at 6:07 this morning.', READING)).toBeUndefined();
        expect(inventedFigure('On the 31st it was much the same.', READING)).toBeUndefined();
        expect(inventedFigure('The wettest August since 2019.', READING)).toBeUndefined();
    });

    it('matches a figure the model rounded, since a rounded true figure is still true', () => {
        const fractional: SpokenWeather = { ...READING, current: { condition: 'rain', words: 'raining', temperature: 17 } };
        expect(inventedFigure("It's 17 degrees.", fractional)).toBeUndefined();
    });

    it('passes a script with no figures in it at all', () => {
        expect(inventedFigure("It's raining in Atlanta and it does not look like stopping.", READING)).toBeUndefined();
    });
});

describe('mentionsWeather', () => {
    it("answers yes for the sentence the feature exists for, where the reading's own word is never said", () => {
        // The reading says `clear` and the presenter says "sunny". A test that looked for the word
        // the prompt showed would answer NO here, leave the break unstamped, and let a sunny
        // afternoon go out at dusk. This is the case the vocabulary exists for.
        expect(mentionsWeather("It's sunny today, get out there and tan while you listen to this one.", SUNNY)).toBe(true);
    });

    it('answers yes on a figure the reading carried', () => {
        // By the time this is asked, `inventedFigure` has already refused every number that was not
        // measured — so a number still in the script is one the service reported.
        expect(mentionsWeather("Twenty-six out there. 26, and I'm not moving.", SUNNY)).toBe(true);
    });

    it('answers yes on the place the reading is about', () => {
        expect(mentionsWeather('Atlanta, you know what this one is.', READING)).toBe(true);
    });

    it('answers yes on a forecast day rather than only on the conditions now', () => {
        // The reading is raining now and clear later, so a break looking ahead has still reported it.
        expect(mentionsWeather('Stick with me, it clears up later on.', READING)).toBe(true);
    });

    it('answers no for an ordinary link that ignored the reading, which is most of them', () => {
        expect(mentionsWeather('That was John Martyn, and this one has been stuck in my head all week.', READING)).toBe(false);
    });

    it('does not read a day of the week as the sky', () => {
        // `sun` would match inside "Sunday", and a false yes is the direction that costs a break:
        // it would be reopened, and eventually dropped, over a claim it never made.
        expect(mentionsWeather('Sunday night and we are only getting started.', SUNNY)).toBe(false);
    });

    it('does not read a year or a clock time as a measurement', () => {
        // The same exclusion `inventedFigure` makes, applied to the same text, so the two cannot
        // disagree about which runs of digits are figures at all.
        expect(mentionsWeather('A 1967 pressing, and we are on at 9:30.', SUNNY)).toBe(false);
    });

    it('answers yes however the model inflected the word', () => {
        // Matched as a fragment rather than a whole word, so the noun, the adjective and the
        // participle are all reached by one string.
        expect(mentionsWeather('The rain has not let up.', READING)).toBe(true);
        expect(mentionsWeather('A rainy sort of afternoon.', READING)).toBe(true);
        expect(mentionsWeather('It rains here like nowhere else.', READING)).toBe(true);
    });

    it('answers no when the sky was described in words no list anticipated, which is its known floor', () => {
        // Stated as a test so the gap is a decision rather than a surprise: the break airs unstamped
        // and the exposure is one talk break with a soft claim in it. The alternative is asking a
        // model to tell us what it just did.
        expect(mentionsWeather('You can see your breath out there tonight.', SUNNY)).toBe(false);
    });
});
