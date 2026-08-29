// The plugin itself: what it asks for, of whom, and what it does when a place
// cannot be found or the operator has not finished the form. The mappings are
// pinned next door in weather.parsers.test.ts and weather.codes.test.ts; what is
// under test here is the dispatch, the request each service actually receives,
// and the two caches.

import { beforeEach, describe, expect, it } from 'vitest';
import { createFakePluginHost, type FakePluginHost } from '@deadair/plugin-sdk/testing';

import { WeatherPlugin } from '../src/weather.plugin.js';
import {
    MAX_FORECAST_DAYS,
    NWS_HOST,
    OPENWEATHERMAP_HOST,
    OPEN_METEO_GEOCODING_HOST,
    OPEN_METEO_HOST,
    REQUEST_TIMEOUT_MS,
    weatherManifest,
} from '../src/weather.manifest.js';

let host: FakePluginHost;
let plugin: WeatherPlugin;

const initialize = async (config: Record<string, unknown> = {}): Promise<void> => {
    host.seedConfig({ engine: 'openmeteo', ...config });
    await plugin.init(host);
};

const queueJson = (body: unknown, status = 200): void =>
    host.queueResponse({ status, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

const GEOCODED = { results: [{ name: 'Atlanta', latitude: 33.749, longitude: -84.388, admin1: 'Georgia' }] };

const OPEN_METEO_ANSWER = {
    utc_offset_seconds: -14_400,
    current: { time: '2026-08-29T09:00', temperature_2m: 24.1, weather_code: 0, wind_speed_10m: 9 },
};

beforeEach(() => {
    host = createFakePluginHost();
    plugin = new WeatherPlugin();
});

describe('manifest', () => {
    it('declares the one capability it implements', () => {
        expect(weatherManifest.capabilities).toEqual(['weather']);
    });

    it('names every service outright, because an operator picks a supplier and not an address', () => {
        expect(weatherManifest.permissions.network).toEqual([
            expect.objectContaining({ host: OPEN_METEO_HOST }),
            expect.objectContaining({ host: OPEN_METEO_GEOCODING_HOST }),
            expect.objectContaining({ host: NWS_HOST }),
            expect.objectContaining({ host: OPENWEATHERMAP_HOST }),
        ]);
    });

    it('gives each service its own rate bucket, so a slow one does not hold up the rest', () => {
        // Different buckets never pace each other, which matters because the
        // National Weather Service arm makes three requests in a row after one to
        // the geocoder — a shared bucket would park between each of them.
        const buckets = weatherManifest.permissions.network.map(entry => ('bucket' in entry ? entry.bucket : undefined));
        expect(new Set(buckets).size).toBe(3);
    });

    it('asks for no storage, since a reading is worth minutes', () => {
        expect(weatherManifest.permissions.storage).toBe(false);
        expect(weatherManifest.permissions.oauth).toBe(false);
    });

    it('defaults to the service that needs no account, so a fresh install works', () => {
        expect(weatherManifest.configFields.find(field => field.key === 'engine')?.default).toBe('openmeteo');
    });
});

describe('Open-Meteo, the default', () => {
    it('geocodes the place and then asks about the coordinates', async () => {
        await initialize();
        queueJson(GEOCODED);
        queueJson(OPEN_METEO_ANSWER);

        const reading = await plugin.getWeather({ place: 'Atlanta' });

        expect(host.calls).toHaveLength(2);
        expect(host.calls[0]?.url).toContain(`${OPEN_METEO_GEOCODING_HOST}/v1/search`);
        expect(host.calls[0]?.url).toContain('name=Atlanta');
        expect(host.calls[1]?.url).toContain(`${OPEN_METEO_HOST}/v1/forecast`);
        expect(host.calls[1]?.url).toContain('latitude=33.749');
        expect(reading).toMatchObject({ place: 'Atlanta, Georgia', current: { condition: 'clear', temperatureC: 24.1 } });
    });

    it("asks for the place's own timezone, which is what makes a forecast day mean anything", async () => {
        await initialize();
        queueJson(GEOCODED);
        queueJson({ ...OPEN_METEO_ANSWER, daily: { time: ['2026-08-29'], weather_code: [0] } });

        await plugin.getWeather({ place: 'Atlanta', days: 3 });

        expect(host.calls[1]?.url).toContain('timezone=auto');
        expect(host.calls[1]?.url).toContain('forecast_days=3');
    });

    it('asks for no daily block at all when nobody wanted a forecast', async () => {
        // `forecast_days=1` still returns today, so a caller asking for none has
        // to be answered by leaving the parameter off rather than by lowering it.
        await initialize();
        queueJson(GEOCODED);
        queueJson(OPEN_METEO_ANSWER);

        await plugin.getWeather({ place: 'Atlanta' });

        expect(host.calls[1]?.url).not.toContain('forecast_days');
        expect(host.calls[1]?.url).not.toContain('daily=');
    });

    it('will not ask for more days than any of these services is worth asking for', async () => {
        await initialize();
        queueJson(GEOCODED);
        queueJson({ ...OPEN_METEO_ANSWER, daily: { time: ['2026-08-29'], weather_code: [0] } });

        await plugin.getWeather({ place: 'Atlanta', days: 90 });

        expect(host.calls[1]?.url).toContain(`forecast_days=${MAX_FORECAST_DAYS}`);
    });
});

describe('the National Weather Service', () => {
    const POINTS = {
        properties: {
            forecast: `https://${NWS_HOST}/gridpoints/FFC/51,88/forecast`,
            forecastHourly: `https://${NWS_HOST}/gridpoints/FFC/51,88/forecast/hourly`,
            relativeLocation: { properties: { city: 'Atlanta', state: 'GA' } },
        },
    };

    const HOURLY = {
        properties: { periods: [{ startTime: '2026-08-29T09:00:00-04:00', temperature: 24, icon: '/icons/land/day/skc' }] },
    };

    it('borrows the keyless geocoder, then asks the grid the service names', async () => {
        await initialize({ engine: 'nws' });
        queueJson(GEOCODED);
        queueJson(POINTS);
        queueJson(HOURLY);

        const reading = await plugin.getWeather({ place: 'Atlanta' });

        expect(host.calls.map(call => new URL(call.url).hostname)).toEqual([OPEN_METEO_GEOCODING_HOST, NWS_HOST, NWS_HOST]);
        // The service's own name for the grid wins over the geocoder's, because
        // it is the service's own idea of where it is forecasting for.
        expect(reading?.place).toBe('Atlanta, GA');
    });

    it('asks for SI units, which is the one parameter that must never be dropped', async () => {
        // The service answers in Fahrenheit by default and the capability is
        // metric. A reading that silently arrives in Fahrenheit is a station
        // announcing 72 degrees in London.
        await initialize({ engine: 'nws' });
        queueJson(GEOCODED);
        queueJson(POINTS);
        queueJson(HOURLY);

        await plugin.getWeather({ place: 'Atlanta' });

        expect(host.calls[2]?.url).toContain('units=si');
    });

    it('says which service covers only the United States when it answers 404', async () => {
        await initialize({ engine: 'nws' });
        queueJson(GEOCODED);
        host.queueResponse({ status: 404, body: '{}' });

        await expect(plugin.getWeather({ place: 'Paris' })).rejects.toThrow(/United States only/);
    });
});

describe('OpenWeatherMap', () => {
    it('uses its own geocoder rather than borrowing the keyless one', async () => {
        await initialize({ engine: 'openweathermap', apiKey: 'a-key' });
        queueJson([{ name: 'Atlanta', lat: 33.749, lon: -84.388, state: 'Georgia' }]);
        queueJson({ dt: 1_800_000_000, timezone: -14_400, name: 'Atlanta', weather: [{ id: 800 }], main: { temp: 24 } });

        const reading = await plugin.getWeather({ place: 'Atlanta' });

        expect(host.calls.every(call => new URL(call.url).hostname === OPENWEATHERMAP_HOST)).toBe(true);
        expect(host.calls[0]?.url).toContain('/geo/1.0/direct');
        expect(reading?.current.condition).toBe('clear');
    });

    it('asks for metric, and converts the wind that comes back with it', async () => {
        await initialize({ engine: 'openweathermap', apiKey: 'a-key' });
        queueJson([{ name: 'Atlanta', lat: 33.749, lon: -84.388 }]);
        queueJson({ dt: 1_800_000_000, timezone: 0, weather: [{ id: 800 }], main: { temp: 24 }, wind: { speed: 10 } });

        const reading = await plugin.getWeather({ place: 'Atlanta' });

        expect(host.calls[1]?.url).toContain('units=metric');
        expect(reading?.current.windKph).toBe(36);
    });

    it('names the key when the service says 401, which the status alone does not', async () => {
        await initialize({ engine: 'openweathermap', apiKey: 'wrong' });
        host.queueResponse({ status: 401, body: '{}' });

        await expect(plugin.getWeather({ place: 'Atlanta' })).rejects.toThrow(/key/);
    });

    it('answers nothing without a key rather than asking with an empty one', async () => {
        await initialize({ engine: 'openweathermap' });

        expect(await plugin.getWeather({ place: 'Atlanta' })).toBeUndefined();
        expect(host.calls).toHaveLength(0);
    });
});

describe('what it does when it cannot answer', () => {
    it('answers nothing for a place nothing could find, which is an ordinary outcome', async () => {
        await initialize();
        queueJson({});

        expect(await plugin.getWeather({ place: 'Nowheresville' })).toBeUndefined();
    });

    it('throws when the service REFUSED, because that is not the same as nowhere of that name', async () => {
        // A rate limit reported as "nowhere of that name" is a station that looks
        // as though it is asking about somewhere that does not exist.
        await initialize();
        host.queueResponse({ status: 429, body: '{}', headers: { 'retry-after': '30' } });

        await expect(plugin.getWeather({ place: 'Atlanta' })).rejects.toThrow(/429/);
    });

    it('answers nothing for a blank place without asking anybody', async () => {
        await initialize();

        expect(await plugin.getWeather({ place: '   ' })).toBeUndefined();
        expect(host.calls).toHaveLength(0);
    });

    it('sheds the work when there is not enough of the call left to finish it', async () => {
        await initialize();
        host.seedRemainingMs(REQUEST_TIMEOUT_MS - 1);

        expect(await plugin.getWeather({ place: 'Atlanta' })).toBeUndefined();
        expect(host.calls).toHaveLength(0);
    });

    it('falls back to the keyless service when the saved engine is one it cannot read', async () => {
        // Read leniently here where the manifest's schema refuses it: a running
        // station handed a value it cannot parse should keep working, and falling
        // back is safe precisely because that service needs no credential.
        await initialize({ engine: 'a-service-that-went-away' });
        queueJson(GEOCODED);
        queueJson(OPEN_METEO_ANSWER);

        await plugin.getWeather({ place: 'Atlanta' });

        expect(new URL(host.calls[0]?.url ?? '').hostname).toBe(OPEN_METEO_GEOCODING_HOST);
    });
});

describe('the two caches', () => {
    it('asks the geocoder once for a place, because a town does not move', async () => {
        await initialize();
        queueJson(GEOCODED);
        queueJson(OPEN_METEO_ANSWER);
        queueJson(OPEN_METEO_ANSWER);

        await plugin.getWeather({ place: 'Atlanta' });
        await plugin.getWeather({ place: 'Atlanta', days: 2 });

        expect(host.calls.filter(call => call.url.includes(OPEN_METEO_GEOCODING_HOST))).toHaveLength(1);
    });

    it('hands back a reading it already has, which is what stops one break asking twice', async () => {
        await initialize();
        queueJson(GEOCODED);
        queueJson(OPEN_METEO_ANSWER);

        const first = await plugin.getWeather({ place: 'Atlanta' });
        const second = await plugin.getWeather({ place: 'Atlanta' });

        expect(second).toEqual(first);
        expect(host.calls).toHaveLength(2);
    });

    it('does not confuse a forecast with the conditions now', async () => {
        // Same place, different question: the cache is keyed by both, or a model
        // asking about the week gets this morning back.
        await initialize();
        queueJson(GEOCODED);
        queueJson(OPEN_METEO_ANSWER);
        queueJson({ ...OPEN_METEO_ANSWER, daily: { time: ['2026-08-29'], weather_code: [61] } });

        await plugin.getWeather({ place: 'Atlanta' });
        const week = await plugin.getWeather({ place: 'Atlanta', days: 7 });

        expect(week?.days?.[0]?.condition).toBe('rain');
    });

    it('lets everything go when the plugin is unloaded', async () => {
        await initialize();
        queueJson(GEOCODED);
        queueJson(OPEN_METEO_ANSWER);
        await plugin.getWeather({ place: 'Atlanta' });

        await plugin.dispose();

        // A map a plugin forgets lives in the API server until a restart, which
        // matters more in-process than out of it.
        host = createFakePluginHost();
        plugin = new WeatherPlugin();
        await initialize();
        queueJson(GEOCODED);
        queueJson(OPEN_METEO_ANSWER);
        await plugin.getWeather({ place: 'Atlanta' });

        expect(host.calls).toHaveLength(2);
    });
});

describe('identifying the station', () => {
    it("sends the operator's contact when they have given one", async () => {
        // The National Weather Service asks callers to say who they are, and the
        // host's own default header names the software and nobody to write to.
        await initialize({ contact: 'you@example.com' });
        queueJson(GEOCODED);
        queueJson(OPEN_METEO_ANSWER);

        await plugin.getWeather({ place: 'Atlanta' });

        expect(host.calls[0]?.headers?.['User-Agent']).toContain('you@example.com');
    });

    it('leaves the header to the host when no contact is set', async () => {
        await initialize();
        queueJson(GEOCODED);
        queueJson(OPEN_METEO_ANSWER);

        await plugin.getWeather({ place: 'Atlanta' });

        expect(host.calls[0]?.headers?.['User-Agent']).toBeUndefined();
    });
});

describe('testConnection', () => {
    it('names the place that came back, which is where this plugin is usually wrong', async () => {
        // The commonest failure is not failing: it is confidently answering about
        // a different town of the same name.
        await initialize();
        queueJson(GEOCODED);
        queueJson({ ...OPEN_METEO_ANSWER, daily: { time: ['2026-08-29'], weather_code: [0] } });

        const result = await plugin.testConnection();

        expect(result.ok).toBe(true);
        expect(result.message).toContain('Atlanta, Georgia');
        expect(result.message).toContain('24.1');
    });

    it('reports a place nothing could find as a failure rather than as a quiet nothing', async () => {
        await initialize();
        queueJson({});

        const result = await plugin.testConnection();

        expect(result.ok).toBe(false);
    });

    it('reports the service refusing, with what it said', async () => {
        await initialize();
        host.queueResponse({ status: 500, body: '{}' });

        const result = await plugin.testConnection();

        expect(result.ok).toBe(false);
        expect(result.message).toContain('500');
    });
});
