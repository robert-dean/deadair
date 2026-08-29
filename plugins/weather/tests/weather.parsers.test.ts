// Three services' JSON, pinned against fixtures shaped like what they actually
// send.
//
// Every parser here is pure and exported separately from the request that feeds
// it, which is `parseFeed`'s split for `parseFeed`'s reason: a saved response
// pins the mapping with no host in the way, and a field rename upstream shows up
// as a failing assertion rather than as a station that has quietly stopped
// mentioning the wind.

import { describe, expect, it } from 'vitest';

import { parseGeocoding } from '../src/weather.geocode.js';
import { parseOpenMeteoForecast } from '../src/openmeteo.provider.js';
import { parseNwsForecast, parseNwsHourly, parseNwsPoints, windKph } from '../src/nws.provider.js';
import { parseOpenWeatherCurrent, parseOpenWeatherForecast, parseOpenWeatherGeocoding } from '../src/openweathermap.provider.js';

describe('the Open-Meteo geocoder', () => {
    const answer = {
        results: [
            {
                id: 4_180_439,
                name: 'Atlanta',
                latitude: 33.749,
                longitude: -84.38798,
                country: 'United States',
                admin1: 'Georgia',
                timezone: 'America/New_York',
            },
        ],
    };

    it('reads the first result, which is the biggest place of that name', () => {
        expect(parseGeocoding(answer)).toEqual({ name: 'Atlanta, Georgia', latitude: 33.749, longitude: -84.38798 });
    });

    it('qualifies with the region rather than the country, because that is what a person says', () => {
        // "Atlanta, Georgia, United States" is nobody's answer to where they
        // live, and the point of this string is that a presenter could read it.
        expect(parseGeocoding(answer)?.name).toBe('Atlanta, Georgia');
    });

    it('falls back to the country where the service names no region', () => {
        const withoutRegion = { results: [{ name: 'Monaco', latitude: 43.7, longitude: 7.4, country: 'Monaco' }] };
        // The country repeats the name here, so it is left off rather than
        // producing "Monaco, Monaco".
        expect(parseGeocoding(withoutRegion)?.name).toBe('Monaco');

        const elsewhere = { results: [{ name: 'Reykjavík', latitude: 64.1, longitude: -21.9, country: 'Iceland' }] };
        expect(parseGeocoding(elsewhere)?.name).toBe('Reykjavík, Iceland');
    });

    it('answers nothing when nothing matched, which the service says by omitting the array', () => {
        expect(parseGeocoding({})).toBeUndefined();
        expect(parseGeocoding({ results: [] })).toBeUndefined();
        expect(parseGeocoding('not json at all')).toBeUndefined();
    });

    describe('choosing between places of one name', () => {
        const springfields = {
            results: [
                { name: 'Springfield', latitude: 37.2, longitude: -93.3, admin1: 'Missouri', country: 'United States' },
                { name: 'Springfield', latitude: 42.1, longitude: -72.6, admin1: 'Massachusetts', country: 'United States' },
            ],
        };

        it('takes the one whose region the operator named after the comma', () => {
            expect(parseGeocoding(springfields, 'Massachusetts')?.name).toBe('Springfield, Massachusetts');
        });

        it('matches on the county too, since an operator naming one should not have to know which field it is', () => {
            const chipping = {
                results: [{ name: 'Chipping Norton', latitude: 51.9, longitude: -1.5, admin1: 'England', admin2: 'Oxfordshire' }],
            };

            expect(parseGeocoding(chipping, 'Oxfordshire')?.name).toBe('Chipping Norton, England');
        });

        it('matches on the country, since "Springfield, USA" names one', () => {
            expect(parseGeocoding(springfields, 'United States')?.name).toBe('Springfield, Missouri');
        });

        it('falls back to the first when nothing carries the qualifier, rather than to nothing', () => {
            // The biggest place of that name is a better answer than silence, and the name that comes
            // back says which one it was.
            expect(parseGeocoding(springfields, 'Oxfordshire')?.name).toBe('Springfield, Missouri');
        });

        it('ignores a qualifier when the caller gave none', () => {
            expect(parseGeocoding(springfields)?.name).toBe('Springfield, Missouri');
        });
    });
});

describe('Open-Meteo forecasts', () => {
    const answer = {
        latitude: 51.5,
        longitude: -0.12,
        utc_offset_seconds: 3_600,
        timezone: 'Europe/London',
        current: {
            time: '2026-08-29T09:00',
            temperature_2m: 17.4,
            apparent_temperature: 16.1,
            relative_humidity_2m: 72,
            precipitation: 0,
            weather_code: 61,
            wind_speed_10m: 14.8,
        },
        daily: {
            time: ['2026-08-29', '2026-08-30'],
            weather_code: [61, 3],
            temperature_2m_max: [19.2, 21.6],
            temperature_2m_min: [12.1, 13.4],
            precipitation_probability_max: [70, 10],
            wind_speed_10m_max: [22.3, 15.0],
            sunrise: ['2026-08-29T06:07', '2026-08-30T06:09'],
            sunset: ['2026-08-29T19:52', '2026-08-30T19:50'],
        },
    };

    it('reads the current conditions, in the units the capability asks for', () => {
        const reading = parseOpenMeteoForecast(answer, 'London');

        expect(reading?.place).toBe('London');
        expect(reading?.current).toEqual({
            condition: 'rain',
            description: 'light rain',
            temperatureC: 17.4,
            feelsLikeC: 16.1,
            windKph: 14.8,
            humidity: 72,
        });
    });

    it("puts the offset back onto the service's local timestamps", () => {
        // The service reports "2026-08-29T09:00" and the offset separately, and
        // a reader who takes the first for UTC is an hour out here and thirteen
        // in Auckland.
        expect(parseOpenMeteoForecast(answer, 'London')?.observedAt).toBe('2026-08-29T09:00:00+01:00');
        expect(parseOpenMeteoForecast(answer, 'London')?.days?.[0]?.sunrise).toBe('2026-08-29T06:07:00+01:00');
    });

    it('reads the columnar daily block as rows', () => {
        const days = parseOpenMeteoForecast(answer, 'London')?.days ?? [];

        expect(days).toHaveLength(2);
        expect(days[0]).toEqual({
            date: '2026-08-29',
            condition: 'rain',
            description: 'light rain',
            highC: 19.2,
            lowC: 12.1,
            windKph: 22.3,
            precipitationChance: 70,
            sunrise: '2026-08-29T06:07:00+01:00',
            sunset: '2026-08-29T19:52:00+01:00',
        });
        expect(days[1]?.condition).toBe('overcast');
    });

    it('leaves the forecast off entirely when none was asked for', () => {
        const { daily: _daily, ...withoutDaily } = answer;
        expect(parseOpenMeteoForecast(withoutDaily, 'London')?.days).toBeUndefined();
    });

    it('drops a day with no date rather than guessing which one it is', () => {
        const broken = { ...answer, daily: { ...answer.daily, time: ['2026-08-29', 'sometime'] } };
        expect(parseOpenMeteoForecast(broken, 'London')?.days).toHaveLength(1);
    });

    it('answers nothing for a shape it does not recognise, rather than throwing', () => {
        // One field rename upstream must not take the station's whole ability to
        // say what it is like outside.
        expect(parseOpenMeteoForecast({}, 'London')).toBeUndefined();
        expect(parseOpenMeteoForecast({ current: { temperature_2m: 3 } }, 'London')).toBeUndefined();
        expect(parseOpenMeteoForecast(null, 'London')).toBeUndefined();
    });

    it('reports a measurement it did not get as absent rather than as zero', () => {
        const thin = { ...answer, current: { time: '2026-08-29T09:00', weather_code: 0 } };
        const reading = parseOpenMeteoForecast(thin, 'London');

        expect(reading?.current).toEqual({ condition: 'clear', description: 'clear sky' });
        expect('temperatureC' in (reading?.current ?? {})).toBe(false);
    });
});

describe('the National Weather Service', () => {
    it('reads the two forecast URLs and the city the service itself names', () => {
        const points = {
            properties: {
                forecast: 'https://api.weather.gov/gridpoints/FFC/51,88/forecast',
                forecastHourly: 'https://api.weather.gov/gridpoints/FFC/51,88/forecast/hourly',
                relativeLocation: { properties: { city: 'Atlanta', state: 'GA' } },
            },
        };

        expect(parseNwsPoints(points)).toEqual({
            forecastUrl: 'https://api.weather.gov/gridpoints/FFC/51,88/forecast',
            hourlyUrl: 'https://api.weather.gov/gridpoints/FFC/51,88/forecast/hourly',
            place: 'Atlanta, GA',
        });
    });

    it('answers nothing without both URLs, since one of them is the whole read', () => {
        expect(parseNwsPoints({ properties: { forecast: 'https://api.weather.gov/x' } })).toBeUndefined();
        expect(parseNwsPoints({})).toBeUndefined();
    });

    it('takes the first hourly period as the current conditions', () => {
        // This service publishes no observations at these endpoints, so what the
        // station reports as "now" is the hour it is in. Stated here so a reader
        // does not go looking for an observation that was never fetched.
        const hourly = {
            properties: {
                periods: [
                    {
                        startTime: '2026-08-29T09:00:00-04:00',
                        temperature: 24,
                        windSpeed: '13 km/h',
                        icon: 'https://api.weather.gov/icons/land/day/tsra,40?size=small',
                        shortForecast: 'Chance Showers And Thunderstorms',
                        probabilityOfPrecipitation: { value: 40 },
                    },
                ],
            },
        };

        expect(parseNwsHourly(hourly)).toEqual({
            observedAt: '2026-08-29T09:00:00-04:00',
            conditions: {
                condition: 'thunderstorm',
                description: 'chance showers and thunderstorms',
                temperatureC: 24,
                windKph: 13,
                precipitationChance: 40,
            },
        });
    });

    it('folds day and night periods into calendar days', () => {
        // The service publishes halves of days, so "Tuesday" and "Tuesday Night"
        // are two rows about one date: the daytime one describes the day and
        // carries the high, the night one carries the low.
        const forecast = {
            properties: {
                periods: [
                    {
                        name: 'Today',
                        startTime: '2026-08-29T06:00:00-04:00',
                        isDaytime: true,
                        temperature: 29,
                        windSpeed: '10 to 15 km/h',
                        icon: '/icons/land/day/rain,60',
                        shortForecast: 'Rain Likely',
                        probabilityOfPrecipitation: { value: 60 },
                    },
                    {
                        name: 'Tonight',
                        startTime: '2026-08-29T18:00:00-04:00',
                        isDaytime: false,
                        temperature: 18,
                        icon: '/icons/land/night/bkn',
                        shortForecast: 'Mostly Cloudy',
                    },
                    {
                        name: 'Sunday',
                        startTime: '2026-08-30T06:00:00-04:00',
                        isDaytime: true,
                        temperature: 31,
                        icon: '/icons/land/day/skc',
                        shortForecast: 'Sunny',
                    },
                ],
            },
        };

        const days = parseNwsForecast(forecast, 7);

        expect(days).toHaveLength(2);
        expect(days[0]).toMatchObject({ date: '2026-08-29', condition: 'rain', highC: 29, lowC: 18, precipitationChance: 60 });
        expect(days[1]).toMatchObject({ date: '2026-08-30', condition: 'clear', highC: 31 });
    });

    it('still produces a day from a night period alone, which is what asking in the evening gives', () => {
        const evening = {
            properties: {
                periods: [{ startTime: '2026-08-29T20:00:00-04:00', isDaytime: false, temperature: 17, icon: '/icons/land/night/few' }],
            },
        };

        const days = parseNwsForecast(evening, 7);

        // No high, honestly: the station cannot forecast a high for an afternoon
        // that is already over.
        expect(days[0]).toEqual({ date: '2026-08-29', condition: 'clear', lowC: 17, temperatureC: 17 });
    });

    it('honours the day count it was asked for', () => {
        const many = {
            properties: {
                periods: [1, 2, 3, 4].map(day => ({
                    startTime: `2026-08-0${day}T06:00:00-04:00`,
                    isDaytime: true,
                    temperature: 20,
                    icon: '/icons/land/day/skc',
                })),
            },
        };

        expect(parseNwsForecast(many, 2)).toHaveLength(2);
    });

    it('reads the wind out of the prose the service sends, and refuses a unit it did not ask for', () => {
        expect(windKph('13 km/h')).toBe(13);
        // A range takes its first number, which is the one the forecast is most
        // confident about.
        expect(windKph('10 to 15 km/h')).toBe(10);
        // `units=si` is what asks for km/h. A response in mph means that
        // parameter was lost, and reporting 10 mph as 10 km/h would be a gale
        // announced as a breeze.
        expect(windKph('10 mph')).toBeUndefined();
        expect(windKph(undefined)).toBeUndefined();
    });
});

describe('OpenWeatherMap', () => {
    it('reads its own geocoder', () => {
        const answer = [{ name: 'Atlanta', lat: 33.749, lon: -84.388, country: 'US', state: 'Georgia' }];
        expect(parseOpenWeatherGeocoding(answer)).toEqual({ name: 'Atlanta, Georgia', latitude: 33.749, longitude: -84.388 });
    });

    it('answers nothing for a place its index does not hold', () => {
        expect(parseOpenWeatherGeocoding([])).toBeUndefined();
        expect(parseOpenWeatherGeocoding({ message: 'nope' })).toBeUndefined();
    });

    it('converts the wind, which arrives in metres per second under a metric flag', () => {
        const current = {
            dt: Date.UTC(2026, 7, 29, 12, 0) / 1_000,
            timezone: 3_600,
            name: 'London',
            weather: [{ id: 500, main: 'Rain', description: 'light rain' }],
            main: { temp: 17.4, feels_like: 16.1, humidity: 72 },
            wind: { speed: 4.5 },
        };

        const reading = parseOpenWeatherCurrent(current, 'asked for');

        expect(reading?.current.windKph).toBe(16.2);
        expect(reading?.current).toMatchObject({ condition: 'rain', description: 'light rain', temperatureC: 17.4, humidity: 72 });
    });

    it("prefers the forecast service's own name for the place over the geocoder's", () => {
        const current = { dt: 1_800_000_000, timezone: 0, name: 'City of Westminster', weather: [{ id: 800 }], main: { temp: 12 } };
        expect(parseOpenWeatherCurrent(current, 'London')?.place).toBe('City of Westminster');
    });

    it('falls back to the name it was asked about when the response carries none', () => {
        const current = { dt: 1_800_000_000, timezone: 0, weather: [{ id: 800 }], main: { temp: 12 } };
        expect(parseOpenWeatherCurrent(current, 'London')?.place).toBe('London');
    });

    it('folds the three-hourly list into calendar days at the place', () => {
        const hours = [
            { at: Date.UTC(2026, 7, 29, 6), temp: 14, pop: 0.1, id: 802, description: 'scattered clouds' },
            { at: Date.UTC(2026, 7, 29, 12), temp: 21, pop: 0.6, id: 500, description: 'light rain' },
            { at: Date.UTC(2026, 7, 29, 18), temp: 17, pop: 0.2, id: 802, description: 'scattered clouds' },
            { at: Date.UTC(2026, 7, 30, 12), temp: 24, pop: 0, id: 800, description: 'clear sky' },
        ];

        const forecast = {
            city: { name: 'London', timezone: 3_600 },
            list: hours.map(hour => ({
                dt: hour.at / 1_000,
                main: { temp: hour.temp, temp_max: hour.temp, temp_min: hour.temp },
                weather: [{ id: hour.id, description: hour.description }],
                wind: { speed: 3 },
                pop: hour.pop,
            })),
        };

        const days = parseOpenWeatherForecast(forecast, 7);

        expect(days).toHaveLength(2);
        // The high and the low are folded across the whole day rather than
        // sampled, because the entry nearest noon is not reliably the warmest.
        expect(days[0]).toMatchObject({ date: '2026-08-29', highC: 21, lowC: 14, precipitationChance: 60 });
        // The condition is sampled from the entry nearest the middle of the day,
        // which here is the one that says rain.
        expect(days[0]?.condition).toBe('rain');
        expect(days[1]).toMatchObject({ date: '2026-08-30', condition: 'clear', highC: 24 });
    });

    it('answers nothing for a shape it does not recognise', () => {
        expect(parseOpenWeatherCurrent({}, 'London')).toBeUndefined();
        expect(parseOpenWeatherForecast({}, 7)).toEqual([]);
    });
});
