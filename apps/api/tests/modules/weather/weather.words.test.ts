// The conversion out of the capability's metric, which is the one piece of
// arithmetic in the station that only ever runs on air.
//
// It lives in the API rather than in a plugin because what a station SAYS is a
// fact about the station, not about whichever service answered — so these are
// the tests that stop a British station announcing Fahrenheit because somebody
// installed a different plugin.

import { describe, expect, it } from 'vitest';
import type { WeatherReading } from '@deadair/plugin-sdk';

import { conditionWords, degreeLabel, speed, speedLabel, spoken, temperature } from '../../../src/modules/weather/weather.words.js';

const READING: WeatherReading = {
    place: 'Atlanta, Georgia',
    observedAt: '2026-08-29T09:00:00-04:00',
    current: { condition: 'rain', description: 'light rain', temperatureC: 17.4, feelsLikeC: 16.1, windKph: 20, humidity: 72 },
    days: [{ date: '2026-08-29', condition: 'clear', highC: 24.6, lowC: 12.1, sunrise: '2026-08-29T06:07:00-04:00' }],
};

describe('temperature', () => {
    it('rounds to a whole number, because nobody has heard a station say 17.4 degrees', () => {
        expect(temperature(17.4, 'metric')).toBe(17);
    });

    it('converts to Fahrenheit for a station whose listeners think in it', () => {
        expect(temperature(0, 'imperial')).toBe(32);
        expect(temperature(100, 'imperial')).toBe(212);
        expect(temperature(17.4, 'imperial')).toBe(63);
    });

    it('converts a temperature below freezing without losing the sign', () => {
        expect(temperature(-5, 'imperial')).toBe(23);
        expect(temperature(-5, 'metric')).toBe(-5);
    });

    it('answers nothing for a measurement nobody reported', () => {
        // A figure that is absent and a figure that is zero are the same number
        // and very different sentences.
        expect(temperature(undefined, 'metric')).toBeUndefined();
        expect(temperature(undefined, 'imperial')).toBeUndefined();
    });
});

describe('speed', () => {
    it('leaves km/h alone and converts to miles per hour', () => {
        expect(speed(20, 'metric')).toBe(20);
        expect(speed(20, 'imperial')).toBe(12);
        expect(speed(100, 'imperial')).toBe(62);
    });

    it('answers nothing for a wind nobody reported', () => {
        expect(speed(undefined, 'metric')).toBeUndefined();
    });
});

describe('the labels', () => {
    it('names the units a caller is writing down rather than saying', () => {
        expect(degreeLabel('metric')).toBe('°C');
        expect(degreeLabel('imperial')).toBe('°F');
        expect(speedLabel('metric')).toBe('km/h');
        expect(speedLabel('imperial')).toBe('mph');
    });
});

describe('conditionWords', () => {
    it('answers an adjective, so every caller can follow "it is" with it', () => {
        // A noun would make every caller write the same join, and the two that
        // got it wrong would say "it's rain".
        expect(conditionWords('rain')).toBe('raining');
        expect(conditionWords('fog')).toBe('foggy');
        expect(conditionWords('clear')).toBe('clear');
        expect(conditionWords('thunderstorm')).toBe('thundery');
        expect(conditionWords('hail')).toBe('hailing');
    });
});

describe('spoken', () => {
    it('converts every figure and leaves the instants alone', () => {
        const said = spoken(READING, 'imperial');

        expect(said.units).toBe('imperial');
        expect(said.current).toMatchObject({ temperature: 63, feelsLike: 61, wind: 12, humidity: 72 });
        // An instant has no units, so it survives exactly as the plugin gave it.
        expect(said.observedAt).toBe('2026-08-29T09:00:00-04:00');
        expect(said.days?.[0]?.sunrise).toBe('2026-08-29T06:07:00-04:00');
    });

    it('converts the forecast as well as the conditions now', () => {
        const said = spoken(READING, 'imperial');
        expect(said.days?.[0]).toMatchObject({ date: '2026-08-29', high: 76, low: 54, words: 'clear' });
    });

    it('carries the place through as the service resolved it, since that is what gets said', () => {
        expect(spoken(READING).place).toBe('Atlanta, Georgia');
    });

    it('defaults to metric for a station that has not said', () => {
        expect(spoken(READING).current.temperature).toBe(17);
    });

    it("keeps the service's own phrase beside the station's word for it", () => {
        const said = spoken(READING);
        expect(said.current.words).toBe('raining');
        expect(said.current.description).toBe('light rain');
    });

    it('leaves a measurement it never had off entirely rather than reporting it as zero', () => {
        const thin: WeatherReading = { place: 'Nowhere', observedAt: READING.observedAt, current: { condition: 'clear' } };
        const said = spoken(thin);

        expect(said.current).toEqual({ condition: 'clear', words: 'clear' });
        expect('temperature' in said.current).toBe(false);
    });

    it('leaves the forecast off when there is none, rather than answering with an empty list', () => {
        const nowOnly: WeatherReading = { place: 'Nowhere', observedAt: READING.observedAt, current: { condition: 'clear' }, days: [] };
        expect(spoken(nowOnly).days).toBeUndefined();
    });
});
