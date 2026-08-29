// The three condition schemes, pinned against their published tables.
//
// This is the file that catches the failure a weather plugin has that nothing
// else does: a mapping can be wrong without a single request failing, so the
// station confidently says "clear" while it is snowing and nothing anywhere
// logs a thing. Every arm of the SDK's vocabulary is asserted reachable from at
// least one service, because a word nothing can produce is a word a writer will
// be written to handle and never see.

import { describe, expect, it } from 'vitest';
import type { WeatherCondition } from '@deadair/plugin-sdk';

import { conditionFromNwsIcon, conditionFromOpenWeatherId, conditionFromWmoCode, describeWmoCode } from '../src/weather.codes.js';

describe('WMO codes, as Open-Meteo reports them', () => {
    it.each([
        [0, 'clear'],
        [1, 'cloudy'],
        [2, 'cloudy'],
        [3, 'overcast'],
        [45, 'fog'],
        [48, 'fog'],
        [51, 'drizzle'],
        [55, 'drizzle'],
        [61, 'rain'],
        [65, 'rain'],
        [71, 'snow'],
        [75, 'snow'],
        [77, 'snow'],
        [80, 'rain'],
        [82, 'rain'],
        [85, 'snow'],
        [86, 'snow'],
        [95, 'thunderstorm'],
    ] as [number, WeatherCondition][])('reads %i as %s', (code, expected) => {
        expect(conditionFromWmoCode(code)).toBe(expected);
    });

    it('reads freezing drizzle and freezing rain as sleet, which is what arriving as ice means here', () => {
        expect(conditionFromWmoCode(56)).toBe('sleet');
        expect(conditionFromWmoCode(57)).toBe('sleet');
        expect(conditionFromWmoCode(66)).toBe('sleet');
        expect(conditionFromWmoCode(67)).toBe('sleet');
    });

    it('reads a thunderstorm WITH hail as hail, which is the only way that word is ever produced', () => {
        // Deliberate, and the reason is in weather.codes.ts: hail is the part a
        // listener has never heard the station mention, and the thunder survives
        // in the description. Without this, `hail` is a word in the SDK's
        // vocabulary no service can reach.
        expect(conditionFromWmoCode(96)).toBe('hail');
        expect(conditionFromWmoCode(99)).toBe('hail');
        expect(describeWmoCode(96)).toContain('hail');
        expect(describeWmoCode(96)).toContain('thunderstorm');
    });

    it('falls back to the condition that promises least rather than to clear', () => {
        // A code nobody has heard of must not become "clear skies" on air.
        expect(conditionFromWmoCode(1234)).toBe('cloudy');
        expect(conditionFromWmoCode(undefined)).toBe('cloudy');
        expect(conditionFromWmoCode('3')).toBe('cloudy');
    });

    it('has no words for a code it does not know, rather than inventing one', () => {
        expect(describeWmoCode(1234)).toBeUndefined();
        expect(describeWmoCode(undefined)).toBeUndefined();
    });
});

describe('National Weather Service icons', () => {
    it('reads the token out of an icon URL', () => {
        expect(conditionFromNwsIcon('https://api.weather.gov/icons/land/day/skc?size=medium')).toBe('clear');
        expect(conditionFromNwsIcon('https://api.weather.gov/icons/land/night/ovc?size=medium')).toBe('overcast');
    });

    it('ignores the chance a token is qualified with', () => {
        // `tsra,40` is "thunderstorms, 40% chance". The chance is a separate
        // field on the period, so it must not become part of the token.
        expect(conditionFromNwsIcon('https://api.weather.gov/icons/land/day/tsra,40?size=medium')).toBe('thunderstorm');
    });

    it('takes the FIRST half of a period whose weather changes', () => {
        // `rain,60/bkn` is "rain, then broken cloud". The period starts in the
        // rain, and that is what the station is about to talk about.
        expect(conditionFromNwsIcon('https://api.weather.gov/icons/land/day/rain,60/bkn?size=medium')).toBe('rain');
    });

    it('reads the mixed-precipitation tokens as sleet', () => {
        expect(conditionFromNwsIcon('/icons/land/day/rain_snow')).toBe('sleet');
        expect(conditionFromNwsIcon('/icons/land/day/fzra')).toBe('sleet');
        expect(conditionFromNwsIcon('/icons/land/day/snow_sleet')).toBe('sleet');
    });

    it('reads a windy sky as the sky it is, since the wind is already a number', () => {
        expect(conditionFromNwsIcon('/icons/land/day/wind_skc')).toBe('clear');
        expect(conditionFromNwsIcon('/icons/land/day/wind_ovc')).toBe('overcast');
    });

    it('answers nothing for an icon it cannot read, so the caller can fall back', () => {
        expect(conditionFromNwsIcon('https://api.weather.gov/icons/land/day/nonsense')).toBeUndefined();
        expect(conditionFromNwsIcon(undefined)).toBeUndefined();
        expect(conditionFromNwsIcon('')).toBeUndefined();
    });
});

describe('OpenWeatherMap condition ids', () => {
    it('tells a clear sky from a full one, which is four numbers apart', () => {
        expect(conditionFromOpenWeatherId(800)).toBe('clear');
        expect(conditionFromOpenWeatherId(801)).toBe('cloudy');
        expect(conditionFromOpenWeatherId(803)).toBe('cloudy');
        expect(conditionFromOpenWeatherId(804)).toBe('overcast');
    });

    it('names sleet and rain-with-snow before the snow group they sit inside', () => {
        expect(conditionFromOpenWeatherId(611)).toBe('sleet');
        expect(conditionFromOpenWeatherId(613)).toBe('sleet');
        expect(conditionFromOpenWeatherId(615)).toBe('sleet');
        expect(conditionFromOpenWeatherId(616)).toBe('sleet');
        expect(conditionFromOpenWeatherId(600)).toBe('snow');
        expect(conditionFromOpenWeatherId(622)).toBe('snow');
    });

    it.each([
        [200, 'thunderstorm'],
        [232, 'thunderstorm'],
        [300, 'drizzle'],
        [321, 'drizzle'],
        [500, 'rain'],
        [531, 'rain'],
        [701, 'fog'],
        [741, 'fog'],
        [781, 'fog'],
    ] as [number, WeatherCondition][])('reads %i as %s', (id, expected) => {
        expect(conditionFromOpenWeatherId(id)).toBe(expected);
    });

    it('falls back to the condition that promises least', () => {
        expect(conditionFromOpenWeatherId(9_999)).toBe('cloudy');
        expect(conditionFromOpenWeatherId(undefined)).toBe('cloudy');
    });
});

describe('the vocabulary as a whole', () => {
    it('has every word reachable from at least one service', () => {
        const produced = new Set<WeatherCondition>([
            ...[0, 1, 3, 45, 51, 56, 61, 71, 95, 96].map(conditionFromWmoCode),
            ...([conditionFromNwsIcon('/icons/land/day/rain_snow')].filter(Boolean) as WeatherCondition[]),
            ...[300, 804].map(conditionFromOpenWeatherId),
        ]);

        const vocabulary: WeatherCondition[] = ['clear', 'cloudy', 'overcast', 'fog', 'drizzle', 'rain', 'snow', 'sleet', 'thunderstorm', 'hail'];

        expect([...vocabulary].filter(word => !produced.has(word))).toEqual([]);
    });
});
