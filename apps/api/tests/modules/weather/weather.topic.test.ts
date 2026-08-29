// What a location topic means, as opposed to how it is edited.
//
// The chassis knows a topic has a kind, a key, a label and an order, and nothing
// generic ever looks inside its config. This is the only code allowed to, and
// what it is defending against is a half-finished row reaching a weather service
// and coming back with somewhere else's sky.

import { describe, expect, it } from 'vitest';

import { weatherLocation, weatherLocations } from '../../../src/modules/weather/weather.topic.js';
import { WEATHER_TOPIC_KIND } from '../../../src/modules/weather/weather.topic.kind.js';
import { WEATHER_KIND } from '../../../src/modules/weather/weather.kind.js';
import type { Topic } from '../../../src/modules/topics/topic.js';

const topic = (config: Record<string, unknown>, overrides: Partial<Topic> = {}): Topic => ({
    id: 'topic-1',
    kind: WEATHER_KIND,
    key: 'town',
    label: 'town',
    position: 0,
    config,
    ...overrides,
});

describe('the kind', () => {
    it('calls one of these a location, since the chassis word would be the wrong one on the page', () => {
        expect(WEATHER_TOPIC_KIND.kind).toBe('weather');
        expect(WEATHER_TOPIC_KIND.noun).toEqual({ one: 'location', many: 'locations' });
    });

    it('offers inheritance as the default units, so the first row added pins nothing', () => {
        const units = WEATHER_TOPIC_KIND.fields.find(field => field.key === 'units');
        expect(units?.options?.[0]).toEqual({ value: '', label: 'As the station does' });
    });

    it('requires the place, which is the one field a location cannot be looked up without', () => {
        expect(WEATHER_TOPIC_KIND.fields.find(field => field.key === 'place')?.required).toBe(true);
    });

    it('says these are the OTHER places, so an operator does not duplicate their own town', () => {
        expect(WEATHER_TOPIC_KIND.description).toMatch(/Settings/);
    });
});

describe('weatherLocation', () => {
    it('keeps the label and the place apart, which is the whole reason there are two fields', () => {
        // A service finds "Chipping Norton, Oxfordshire, England" and a presenter
        // says "town".
        const location = weatherLocation(topic({ place: 'Chipping Norton, Oxfordshire' }));

        expect(location).toEqual({ key: 'town', label: 'town', place: 'Chipping Norton, Oxfordshire' });
    });

    it('reads a units override when the row sets one', () => {
        expect(weatherLocation(topic({ place: 'Boston', units: 'imperial' }))?.units).toBe('imperial');
    });

    it('leaves the units off for the empty value the form stores for inheritance', () => {
        expect(weatherLocation(topic({ place: 'Boston', units: '' }))?.units).toBeUndefined();
        expect(weatherLocation(topic({ place: 'Boston' }))?.units).toBeUndefined();
    });

    it('leaves the units off for a value nobody can parse, rather than picking one', () => {
        expect(weatherLocation(topic({ place: 'Boston', units: 'furlongs' }))?.units).toBeUndefined();
    });

    it('drops a row with no place rather than falling back to the label', () => {
        // A label is what the station says out loud and is frequently not a name
        // any service would find, so looking one up would produce the weather
        // somewhere else and announce it confidently.
        expect(weatherLocation(topic({}))).toBeUndefined();
        expect(weatherLocation(topic({ place: '   ' }))).toBeUndefined();
    });
});

describe('weatherLocations', () => {
    it("keeps the operator's own order and drops the unfinished rows", () => {
        const rows = [
            topic({ place: 'Atlanta' }, { key: 'atlanta', position: 0 }),
            topic({}, { key: 'unfinished', position: 1 }),
            topic({ place: 'Boston' }, { key: 'boston', position: 2 }),
        ];

        expect(weatherLocations(rows).map(location => location.key)).toEqual(['atlanta', 'boston']);
    });
});
