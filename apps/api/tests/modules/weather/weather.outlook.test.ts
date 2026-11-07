// The next few hours, as sentences. Every rule here is one a station got wrong on air somewhere:
// a 5% chance called likely, rain called on a clear row, an outlook counted from a cached reading's
// first row rather than from the moment it airs, and a temperature with no unit on it.

import { describe, expect, it } from 'vitest';
import type { WeatherCondition } from '@deadair/plugin-sdk';

import {
    byClock,
    hoursAway,
    keyOf,
    outlookNotes,
    outlookSaidOf,
    outlookWindow,
    sameNews,
    unsaid,
    type OutlookNote,
} from '../../../src/modules/weather/weather.outlook.js';
import type { SpokenHour, SpokenWeather } from '../../../src/modules/weather/weather.words.js';

/** 13:00 in Atlanta, in November. */
const AIRS_AT = Date.parse('2026-11-07T13:00:00-05:00');

const hour = (clock: string, condition: WeatherCondition, extra: Partial<SpokenHour> = {}): SpokenHour => ({
    at: `2026-11-07T${clock}:00-05:00`,
    condition,
    words: condition,
    ...extra,
});

const reading = (hours: SpokenHour[], extra: Partial<SpokenWeather> = {}): SpokenWeather => ({
    place: 'Atlanta',
    observedAt: '2026-11-07T12:45:00-05:00',
    units: 'metric',
    current: { condition: 'cloudy', words: 'cloudy', temperature: 12 },
    hours,
    ...extra,
});

/** Six hourly rows from 13:00, all at 12 degrees and cloudy, with one changed. */
const day = (changed: Record<string, Partial<SpokenHour> & { condition?: WeatherCondition }> = {}): SpokenHour[] =>
    ['13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00'].map(clock => {
        const { condition, ...rest } = changed[clock] ?? {};
        return hour(clock, condition ?? 'cloudy', { temperature: 12, ...rest });
    });

describe('precipitation', () => {
    it('says likely, with the figure, at 50% and above', () => {
        const notes = outlookNotes(reading(day({ '16:00': { condition: 'rain', precipitationChance: 50 } })), AIRS_AT);

        expect(notes).toEqual([
            {
                kind: 'precipitation',
                word: 'rain',
                band: 'likely',
                at: '2026-11-07T16:00:00-05:00',
                text: 'Rain likely in about three hours, a 50% chance.',
            },
        ]);
    });

    it("says possible, in the row's own word and with no figure, at 49%", () => {
        const [note] = outlookNotes(reading(day({ '16:00': { condition: 'drizzle', precipitationChance: 49 } })), AIRS_AT);

        expect(note).toMatchObject({ band: 'possible', text: 'Drizzle possible in about three hours.' });
        expect(note?.text).not.toMatch(/\d/);
    });

    it('says nothing below 30%, and possible from 30%', () => {
        expect(outlookNotes(reading(day({ '15:00': { condition: 'rain', precipitationChance: 29 } })), AIRS_AT)).toEqual([]);
        expect(outlookNotes(reading(day({ '15:00': { condition: 'rain', precipitationChance: 30 } })), AIRS_AT)[0]?.band).toBe('possible');
    });

    it('calls a 5% chance nothing at all, whatever the code says', () => {
        expect(outlookNotes(reading(day({ '14:00': { condition: 'thunderstorm', precipitationChance: 5 } })), AIRS_AT)).toEqual([]);
    });

    it('says a wet row with no chance at all as a possibility, since the service gave no figure', () => {
        const [note] = outlookNotes(reading(day({ '17:00': { condition: 'snow', temperature: -1 } })), AIRS_AT);
        expect(note?.text).toBe('Snow possible in about four hours.');
    });

    it('keeps a cloudy row cloudy at 70%, and says the rain it is likely to bring', () => {
        const [note] = outlookNotes(reading(day({ '15:00': { condition: 'cloudy', precipitationChance: 70 } })), AIRS_AT);
        expect(note).toMatchObject({ word: 'rain', band: 'likely', text: 'Rain likely in about two hours, a 70% chance.' });
    });

    it('names a dry row snow at or below freezing and rain above it, in either unit', () => {
        const at = (temperature: number, units: 'metric' | 'imperial') =>
            outlookNotes(reading(day({ '15:00': { condition: 'overcast', precipitationChance: 80, temperature } }), { units }), AIRS_AT)[0]?.word;

        expect(at(0, 'metric')).toBe('snow');
        expect(at(1, 'metric')).toBe('rain');
        expect(at(32, 'imperial')).toBe('snow');
        expect(at(33, 'imperial')).toBe('rain');
    });

    it('does not call rain on a clear row below the likely line, and does not guess with no temperature', () => {
        expect(outlookNotes(reading(day({ '15:00': { condition: 'clear', precipitationChance: 40 } })), AIRS_AT)).toEqual([]);
        expect(outlookNotes(reading(day({ '15:00': { condition: 'clear', precipitationChance: 90, temperature: undefined } })), AIRS_AT)).toEqual([]);
    });

    it('prefers a likely row to an earlier possible one', () => {
        const hours = day({ '14:00': { condition: 'rain', precipitationChance: 40 }, '17:00': { condition: 'rain', precipitationChance: 90 } });
        expect(outlookNotes(reading(hours), AIRS_AT)[0]?.text).toBe('Rain likely in about four hours, a 90% chance.');
    });

    it('says nothing about rain arriving when it is already raining', () => {
        const hours = day({ '15:00': { condition: 'rain', precipitationChance: 90 } });
        expect(outlookNotes(reading(hours, { current: { condition: 'rain', words: 'raining', temperature: 12 } }), AIRS_AT)).toEqual([]);
    });

    it('says "within the hour" for the row in force when the break airs', () => {
        const [note] = outlookNotes(reading(day({ '13:00': { condition: 'rain', precipitationChance: 60 } })), AIRS_AT + 20 * 60_000);
        expect(note?.text).toBe('Rain likely within the hour, a 60% chance.');
    });

    it('puts the right article in front of the figure', () => {
        expect(outlookNotes(reading(day({ '15:00': { condition: 'rain', precipitationChance: 80 } })), AIRS_AT)[0]?.text).toContain('an 80% chance');
        expect(outlookNotes(reading(day({ '15:00': { condition: 'rain', precipitationChance: 60 } })), AIRS_AT)[0]?.text).toContain('a 60% chance');
    });
});

describe('measured from when the break airs', () => {
    it('counts from airsAt rather than from the first row of a reading cached at :45', () => {
        // Fetched at 10:45, rows from 10:00. The break airs at 13:00, so the 16:00 row is three hours
        // away, not six as its position would say.
        const rows = ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00'].map(clock =>
            hour(clock, clock === '16:00' ? 'rain' : 'cloudy', { temperature: 12, ...(clock === '16:00' ? { precipitationChance: 70 } : {}) }),
        );

        expect(outlookWindow(reading(rows), AIRS_AT).map(row => row.at.slice(11, 16))).toEqual(['13:00', '14:00', '15:00', '16:00', '17:00']);
        expect(outlookNotes(reading(rows), AIRS_AT)[0]?.text).toBe('Rain likely in about three hours, a 70% chance.');
    });

    it('reads three-hourly rows by their own times, the one under way included', () => {
        const rows = [
            hour('10:00', 'cloudy', { temperature: 14 }),
            hour('13:00', 'cloudy', { temperature: 13 }),
            hour('16:00', 'rain', { temperature: 10, precipitationChance: 60 }),
            hour('19:00', 'cloudy', { temperature: 7 }),
            hour('22:00', 'cloudy', { temperature: 5 }),
        ];

        // At 14:30 the 13:00 row is the one in force and the 22:00 one is past the window.
        const airsAt = Date.parse('2026-11-07T14:30:00-05:00');
        expect(outlookWindow(reading(rows), airsAt).map(row => row.at.slice(11, 16))).toEqual(['13:00', '16:00', '19:00']);
        expect(outlookNotes(reading(rows), airsAt).map(note => note.text)).toEqual([
            'Rain likely in about two hours, a 60% chance.',
            'Down to 7 degrees Celsius by seven this evening.',
        ]);
    });

    it('has nothing to say from a reading whose rows have all passed', () => {
        const rows = ['08:00', '09:00', '10:00'].map(clock => hour(clock, 'rain', { precipitationChance: 90, temperature: 2 }));
        expect(outlookNotes(reading(rows), AIRS_AT)).toEqual([]);
    });
});

describe('temperature', () => {
    it('says a fall of 5°C, with its unit, and not one of 4', () => {
        expect(outlookNotes(reading(day({ '19:00': { temperature: 7 } })), AIRS_AT)[0]?.text).toBe(
            'Down to 7 degrees Celsius by seven this evening.',
        );
        expect(outlookNotes(reading(day({ '19:00': { temperature: 8 } })), AIRS_AT)).toEqual([]);
    });

    it('says a rise of 8°F, with its unit, and not one of 7', () => {
        const at = (temperature: number) =>
            outlookNotes(
                reading(
                    day({ '16:00': { temperature } }).map(row => (row.at.includes('T16') ? row : { ...row, temperature: 50 })),
                    {
                        units: 'imperial',
                        current: { condition: 'cloudy', words: 'cloudy', temperature: 50 },
                    },
                ),
                AIRS_AT,
            );

        expect(at(58)[0]?.text).toBe('Up to 58 degrees Fahrenheit by four this afternoon.');
        expect(at(57)).toEqual([]);
    });

    it('takes a 5-degree swing as nothing in Fahrenheit', () => {
        const hours = day({ '19:00': { temperature: 7 } });
        expect(outlookNotes(reading(hours, { units: 'imperial' }), AIRS_AT)).toEqual([]);
    });
});

describe('the words for when', () => {
    it('spells hours out, so the only digits in a note are measured figures', () => {
        expect(hoursAway(AIRS_AT + 60 * 60_000, AIRS_AT)).toBe('in about an hour');
        expect(hoursAway(AIRS_AT + 5.6 * 60 * 60_000, AIRS_AT)).toBe('in about six hours');
        expect(hoursAway(AIRS_AT + 20 * 60_000, AIRS_AT)).toBe('within the hour');
    });

    it("reads the place's own clock off the row", () => {
        expect(byClock('2026-11-07T00:00:00-05:00')).toBe('by midnight');
        expect(byClock('2026-11-07T12:00:00Z')).toBe('by midday');
        expect(byClock('2026-11-08T03:00:00+13:00')).toBe('by three in the morning');
        expect(byClock('2026-11-07T21:00:00-05:00')).toBe('by nine this evening');
        expect(byClock('2026-11-07T23:30:00+05:30')).toBe('by midnight');
    });
});

describe('the same news', () => {
    const note = (at: string, extra: Partial<OutlookNote> = {}): OutlookNote => ({
        kind: 'precipitation',
        word: 'rain',
        band: 'likely',
        at,
        text: 'Rain likely.',
        ...extra,
    });

    it("rounds the onset to the place's own hour, half-hour offsets included", () => {
        expect(keyOf(note('2026-11-07T15:40:00-05:00')).onset).toBe('2026-11-07T21:00:00.000Z');
        expect(keyOf(note('2026-11-07T10:00:00+05:30')).onset).toBe('2026-11-07T04:30:00.000Z');
    });

    it('counts an onset moved by an hour as the same, and by two as news', () => {
        const at3 = keyOf(note('2026-11-07T15:00:00-05:00'));
        expect(sameNews(at3, keyOf(note('2026-11-07T16:00:00-05:00')))).toBe(true);
        expect(sameNews(at3, keyOf(note('2026-11-07T17:00:00-05:00')))).toBe(false);
    });

    it('counts a different word or band as news', () => {
        const rain = keyOf(note('2026-11-07T15:00:00-05:00'));
        expect(sameNews(rain, keyOf(note('2026-11-07T15:00:00-05:00', { word: 'snow' })))).toBe(false);
        expect(sameNews(rain, keyOf(note('2026-11-07T15:00:00-05:00', { band: 'possible' })))).toBe(false);
    });

    it('compares only with a stamp for the same place, and drops a stamp key that matched nothing', () => {
        const given = note('2026-11-07T15:00:00-05:00');
        const previous = {
            place: 'Atlanta',
            notes: [keyOf(given), keyOf(note('2026-11-07T15:00:00-05:00', { kind: 'temperature', word: 'down', band: 'swing' }))],
        };

        expect(unsaid([given], 'Atlanta', previous)).toEqual({ fresh: [], said: { place: 'Atlanta', notes: [keyOf(given)] } });
        expect(unsaid([given], 'Boston', previous).fresh).toEqual([given]);
    });

    it('reads a stamp off a row without trusting it', () => {
        const good = {
            place: 'Atlanta',
            notes: [{ kind: 'precipitation', word: 'rain', band: 'likely', onset: '2026-11-07T20:00:00.000Z' }, { kind: 'wind' }],
        };

        expect(outlookSaidOf(good)?.notes).toHaveLength(1);
        expect(outlookSaidOf(JSON.stringify(good))?.place).toBe('Atlanta');
        expect(outlookSaidOf('not json')).toBeUndefined();
        expect(outlookSaidOf({ notes: [] })).toBeUndefined();
        expect(outlookSaidOf(null)).toBeUndefined();
    });
});
