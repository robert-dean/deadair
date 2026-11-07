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

import { inventedFigure, mentionsWeather, unofferedWeather } from '../../../src/modules/director/weather.figures.js';
import type { WeatherHour } from '@deadair/plugin-sdk';
import { outlookNotes } from '../../../src/modules/weather/weather.outlook.js';
import { spoken, type SpokenWeather } from '../../../src/modules/weather/weather.words.js';

const READING: SpokenWeather = {
    place: 'Atlanta',
    observedAt: '2026-08-29T09:00:00-04:00',
    units: 'metric',
    current: { condition: 'rain', words: 'raining', temperature: 17, wind: 20, humidity: 72 },
    days: [{ date: '2026-08-29', condition: 'clear', words: 'clear', high: 24, low: 12, precipitationChance: 40 }],
};

/** A reading below freezing, where every way of saying the temperature but one has no sign in its digits. */
const FREEZING: SpokenWeather = {
    place: 'Berlin',
    observedAt: '2026-11-04T09:00:00+01:00',
    units: 'metric',
    current: { condition: 'clear', words: 'clear', temperature: -5 },
    days: [{ date: '2026-11-04', condition: 'clear', words: 'clear', high: -2, low: -7 }],
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

    it('reads a hyphen between two figures as a range rather than a minus', () => {
        expect(inventedFigure('Somewhere around 17-24 degrees today.', READING)).toBeUndefined();
        // Each end is still a figure: a range does not excuse the half nobody measured.
        expect(inventedFigure('Somewhere around 17-31 degrees today.', READING)).toBe('31');
    });

    it('reads a hyphen after a word as no sign, and still checks the figure', () => {
        expect(inventedFigure('Up into the mid-24s by teatime.', READING)).toBeUndefined();
        expect(inventedFigure('Up into the mid-30s by teatime.', READING)).toBe('30');
    });

    it('takes a figure below freezing however the minus is written', () => {
        for (const script of [
            "It's -5 degrees.",
            "It's \u22125 degrees.",
            "It's minus 5 degrees.",
            "It's 5 below out there.",
            'Between -7 and -2 today.',
        ]) {
            expect(inventedFigure(script, FREEZING)).toBeUndefined();
        }
    });

    it('holds a written sign to the reading exactly', () => {
        // The reading said 17. A minus in the digits is a claim, and it is one nobody measured.
        expect(inventedFigure("It's -17 degrees.", READING)).toBe('-17');
        expect(inventedFigure("It's \u221217 degrees.", READING)).toBe('\u221217');
        expect(inventedFigure("It's -9 degrees.", FREEZING)).toBe('-9');
    });

    it('reads a minus said in words, and holds it to the reading', () => {
        expect(inventedFigure("It's Minus 17 degrees.", READING)).toBe('Minus 17');
        expect(inventedFigure("It's negative 17 degrees.", READING)).toBe('negative 17');
        expect(inventedFigure("It's 17 degrees below out there.", READING)).toBe('17 degrees below');
        expect(inventedFigure("It's negative 5 degrees.", FREEZING)).toBeUndefined();
        expect(inventedFigure("It's 5 degrees below zero.", FREEZING)).toBeUndefined();
    });

    it('refuses a bare figure when the reading is on the other side of zero', () => {
        expect(inventedFigure("It's 5 degrees.", FREEZING)).toBe('5');
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

    it('answers yes on a figure below freezing with its sign in words', () => {
        expect(mentionsWeather('Minus 5 and that is before the wind.', { ...FREEZING, place: '' })).toBe(true);
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

describe('on a station that does not broadcast in English', () => {
    it('reads a decimal comma as one figure and a date or a continental time as no figure', () => {
        const script = 'Am 29. August um 21.30 Uhr, oder 21h30, sind es 17,2 Grad und bis zu 24 Grad.';

        expect(inventedFigure(script, READING, 'de')).toBeUndefined();
        // The same sentence read as English finds a figure nobody measured in every one of those.
        expect(inventedFigure(script, READING)).toBeDefined();
    });

    it('takes a range and a figure below freezing as a German break writes them', () => {
        expect(inventedFigure('Heute 17-24 Grad.', READING, 'de')).toBeUndefined();
        expect(inventedFigure('Es sind minus 5 Grad, gefühlt -7,0.', FREEZING, 'de')).toBeUndefined();
        expect(inventedFigure('Es sind -4,5 Grad.', FREEZING, 'de')).toBe('-4,5');
    });

    it('judges a figure with no sign in its digits by its size, which is the gap it deliberately has', () => {
        // "Minus" is a word in every language, so reading it would mean a vocabulary per language.
        expect(inventedFigure('Es sind minus 17 Grad.', READING, 'de')).toBeUndefined();
        expect(inventedFigure('Es sind 5 Grad.', FREEZING, 'de')).toBeUndefined();
        expect(inventedFigure('Es sind -17 Grad.', READING, 'de')).toBe('-17');
    });

    it('still names a figure the reading never had', () => {
        expect(inventedFigure('Es sind 31,5 Grad.', READING, 'de')).toBe('31,5');
    });

    it('takes a break offered a reading to have reported it, because the vocabulary is English', () => {
        expect(mentionsWeather('Ein wunderschöner Abend, bleiben Sie dran.', READING, 'de')).toBe(true);
        expect(mentionsWeather('A lovely evening, stay with us.', SUNNY)).toBe(false);
    });
});

describe('unofferedWeather', () => {
    it('finds the sky described by a break that was given no reading', () => {
        expect(unofferedWeather("Sunny out there this afternoon, so here's one for the windows down.")).toBe('Sunny');
        expect(unofferedWeather('It has been raining all day.')).toBe('raining');
        expect(unofferedWeather('A grey, overcast Tuesday.')).toBe('overcast');
        expect(unofferedWeather('Blue skies for the drive home.')).toBe('Blue skies');
    });

    it('finds a temperature, which with no reading behind it is made up', () => {
        expect(unofferedWeather("It's 22 degrees out there.")).toBe('22 degrees');
        expect(unofferedWeather('A cool 15° tonight.')).toBe('15°');
    });

    it('leaves words that are about anything but the sky', () => {
        // The loose vocabulary `mentionsWeather` reads would refuse every one of these.
        expect(unofferedWeather('That record took the charts by storm.')).toBeUndefined();
        expect(unofferedWeather('Come rain or shine, this one never gets old.')).toBeUndefined();
        expect(unofferedWeather('A clear favourite on this station.')).toBeUndefined();
        expect(unofferedWeather('On a Sunday, nothing beats it.')).toBeUndefined();
        expect(unofferedWeather('A bit of sunshine for your afternoon.')).toBeUndefined();
    });

    it('finds the wind, the damp and the heat, which a presenter says about nothing else', () => {
        expect(unofferedWeather('Pretty windy on the bridge this morning.')).toBe('windy');
        expect(unofferedWeather('A gusty one out there, hold on to your hats.')).toBe('gusty');
        expect(unofferedWeather('A blustery afternoon across town.')).toBe('blustery');
        expect(unofferedWeather('Humid again, so stay in with the fan on.')).toBe('Humid');
        expect(unofferedWeather('Another muggy evening.')).toBe('muggy');
        expect(unofferedWeather('Day four of the heatwave.')).toBe('heatwave');
        expect(unofferedWeather('Record rainfall overnight.')).toBe('rainfall');
        expect(unofferedWeather("It's pouring down outside the studio.")).toBe('pouring down');
        expect(unofferedWeather('It was pouring with rain on the way in.')).toBe('pouring with rain');
        expect(unofferedWeather('Scattered showers on the way home.')).toBe('Scattered showers');
    });

    it('leaves the obvious words that ordinary talk about records uses for something else', () => {
        // Each of these was a candidate and was left out on purpose. See WEATHER_WORDS.
        expect(unofferedWeather('Hello sunshine, this one is for you.')).toBeUndefined();
        expect(unofferedWeather('The band had a famously stormy relationship.')).toBeUndefined();
        expect(unofferedWeather('Stormy Weather, the standard everybody has had a go at.')).toBeUndefined();
        expect(unofferedWeather('The second album got a chilly reception.')).toBeUndefined();
        expect(unofferedWeather('A frosty reception from the critics.')).toBeUndefined();
        expect(unofferedWeather('Showers of praise for that one.')).toBeUndefined();
        expect(unofferedWeather('Pouring their hearts out on this record.')).toBeUndefined();
        expect(unofferedWeather('Straight out of the Windy City, here is some Chicago blues.')).toBeUndefined();
    });

    it('asks nothing of a station that does not broadcast in English', () => {
        expect(unofferedWeather('Es ist sonnig und 22 Grad.', 'de')).toBeUndefined();
    });
});

describe('the hourly outlook', () => {
    const airsAt = Date.parse('2026-11-07T20:00:00-05:00');

    /** A reading converted from the same metric rows into either unit, so both are tested on one sky. */
    const outlookIn = (units: 'metric' | 'imperial', rows: WeatherHour[]): SpokenWeather =>
        spoken(
            { place: 'Atlanta', observedAt: '2026-11-07T19:45:00-05:00', current: { condition: 'cloudy', temperatureC: 9.4 }, hours: rows },
            units,
        );

    const at = (clock: string): string => `2026-11-07T${clock}:00-05:00`;

    // Each sky makes at least one note, so between them every shape of sentence is produced.
    const skies: WeatherHour[][] = [
        [
            { at: at('20'), condition: 'cloudy', temperatureC: 9.4 },
            { at: at('22'), condition: 'rain', temperatureC: 6.2, precipitationChance: 85 },
            { at: '2026-11-08T00:00:00-05:00', condition: 'overcast', temperatureC: -2.6, precipitationChance: 10 },
        ],
        [
            { at: at('20'), condition: 'cloudy', temperatureC: 9.4 },
            { at: at('21'), condition: 'overcast', temperatureC: 0.4, precipitationChance: 72 },
            { at: at('23'), condition: 'clear', temperatureC: -4.3 },
        ],
        [
            { at: at('20'), condition: 'cloudy', temperatureC: 9.4 },
            { at: at('22'), condition: 'snow', temperatureC: 18.4, precipitationChance: 41 },
        ],
    ];

    it.each(['metric', 'imperial'] as const)('passes every note it generates, in %s', units => {
        let notes = 0;
        for (const rows of skies) {
            const weather = outlookIn(units, rows);
            for (const note of outlookNotes(weather, airsAt)) {
                notes += 1;
                expect(inventedFigure(note.text, weather), note.text).toBeUndefined();
            }
        }
        // A test whose loop never ran would pass on nothing.
        expect(notes).toBeGreaterThanOrEqual(4);
    });

    it('still refuses a figure the outlook did not carry', () => {
        const weather = outlookIn('metric', skies[0]!);
        expect(inventedFigure('Down to 3 degrees Celsius by midnight.', weather)).toBe('3');
    });
});
