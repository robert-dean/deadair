import { PluginError, type WeatherConditions, type WeatherDay, type WeatherReading } from '@deadair/plugin-sdk';
import { conditionFromNwsIcon } from './weather.codes.js';
import { fetchJson, type Service } from './weather.http.js';
import { field, optional, percentage, reading, text } from './weather.values.js';
import type { GeoPoint } from './weather.geocode.js';
import { MAX_FORECAST_DAYS, NWS_HOST, REQUEST_TIMEOUT_MS } from './weather.manifest.js';

/**
 * The United States National Weather Service: free, public-domain, and the best
 * forecast there is for a station inside its coverage.
 *
 * It is also the most awkward of the three, and every awkward part is a
 * consequence of it being a grid service rather than a place service.
 *
 * **Three requests, not one.** A coordinate has to be turned into a forecast
 * OFFICE and a grid square (`/points`), and the office then serves an hourly
 * forecast and a daily one at URLs it chooses. The grid never moves, so the
 * `/points` answer is worth caching for as long as the plugin is loaded — see
 * {@link NwsGrid} and the cache in `weather.plugin.ts`.
 *
 * **There are no current conditions here.** What this arm reports as `current` is
 * the first HOURLY forecast period, which is the hour the station is in. A true
 * observation would mean finding the nearest reporting station and reading its
 * latest, which is two more requests for a figure that differs from the hourly
 * forecast by less than anybody says out loud.
 *
 * **`units=si` is not optional.** The service answers in Fahrenheit and miles per
 * hour by default, and the capability is metric — so this is the one parameter
 * that must never be dropped from either forecast request. A reading that
 * silently arrives in Fahrenheit is a station announcing 72 degrees in London.
 *
 * **A period is half a day.** The daily forecast comes back as named periods
 * ("Tuesday", "Tuesday Night"), so the daytime ones are the days and the night
 * ones supply the lows. See {@link parseNwsForecast}.
 */

/** Where the service says a coordinate lives, and where it will answer about it. */
export interface NwsGrid {
    /** The hourly forecast for this grid square. */
    hourlyUrl: string;
    /** The daily forecast for this grid square, as day and night periods. */
    forecastUrl: string;
    /**
     * The city the service itself says this grid is closest to, when it says one.
     *
     * Preferred over the geocoder's answer where present, because it is the
     * service's own idea of where it is forecasting for — and because it is the
     * one place a coordinate outside the coverage area quietly becomes visible.
     */
    place?: string;
}

/** Turn a coordinate into the office and grid square that will answer about it. */
export async function nwsGrid(service: Service, point: GeoPoint): Promise<NwsGrid | undefined> {
    const url = `https://${NWS_HOST}/points/${round(point.latitude)},${round(point.longitude)}`;

    const data = await fetchJson(service, url, {
        accept: 'application/geo+json',
        name: 'the National Weather Service',
        timeoutMs: REQUEST_TIMEOUT_MS,
        // The 404 is named because it is the one an operator cannot diagnose from
        // the status: it is what the service answers for anywhere it does not
        // forecast, which is anywhere outside the United States and its
        // territories. Reading it as "the address is wrong" is the trap.
        hint: status => (status === 404 ? 'this service covers the United States only, and answers exactly this for anywhere else' : undefined),
    });

    return parseNwsPoints(data);
}

/** The `/points` answer, as the two URLs and the name worth keeping. */
export function parseNwsPoints(data: unknown): NwsGrid | undefined {
    const properties = field(data, 'properties');
    const hourlyUrl = text(field(properties, 'forecastHourly'));
    const forecastUrl = text(field(properties, 'forecast'));
    if (hourlyUrl === undefined || forecastUrl === undefined) return undefined;

    const relative = field(field(properties, 'relativeLocation'), 'properties');
    const city = text(field(relative, 'city'));
    const state = text(field(relative, 'state'));

    return {
        hourlyUrl,
        forecastUrl,
        ...optional('place', city === undefined ? undefined : state === undefined ? city : `${city}, ${state}`),
    };
}

/** What it is like, out of a grid the service has already named. */
export async function nwsRead(service: Service, grid: NwsGrid, fallbackPlace: string, days: number): Promise<WeatherReading | undefined> {
    const now = parseNwsHourly(await fetchPeriods(service, grid.hourlyUrl));
    if (now === undefined) return undefined;

    const place = grid.place ?? fallbackPlace;
    const wanted = Math.min(Math.max(0, Math.trunc(days)), MAX_FORECAST_DAYS);
    if (wanted === 0) return { place, observedAt: now.observedAt, current: now.conditions };

    const forecast = parseNwsForecast(await fetchPeriods(service, grid.forecastUrl), wanted);
    return { place, observedAt: now.observedAt, current: now.conditions, ...(forecast.length === 0 ? {} : { days: forecast }) };
}

/**
 * One of the office's own forecast URLs, in SI.
 *
 * The URL comes from the `/points` answer rather than being built here, which is
 * the service's own instruction: an office may serve its forecasts from
 * somewhere this plugin has no way to guess. The `units` parameter is appended
 * to whatever it gave.
 */
async function fetchPeriods(service: Service, forecastUrl: string): Promise<unknown> {
    const url = new URL(forecastUrl);
    if (url.hostname !== NWS_HOST) {
        // The host's allowlist would refuse it anyway; saying so here is what
        // turns "forbidden" into a sentence naming which service moved.
        throw new PluginError(`the National Weather Service pointed at ${url.hostname}, which this plugin is not allowed to reach`).withCode(
            'upstream',
        );
    }

    url.searchParams.set('units', 'si');

    return await fetchJson(service, url.toString(), {
        accept: 'application/geo+json',
        name: 'the National Weather Service',
        timeoutMs: REQUEST_TIMEOUT_MS,
    });
}

/** The hour the station is in, which is what this arm reports as current. */
export function parseNwsHourly(data: unknown): { observedAt: string; conditions: WeatherConditions } | undefined {
    const first = periodsOf(data)[0];
    if (first === undefined) return undefined;

    const observedAt = text(field(first, 'startTime'));
    if (observedAt === undefined) return undefined;

    return { observedAt, conditions: conditionsOf(first) };
}

/**
 * The daily forecast, as calendar days.
 *
 * The service publishes PERIODS rather than days: "Tuesday" and "Tuesday Night"
 * are two rows about one date, and the first row of all may be "This Afternoon"
 * or "Tonight" depending on when it is asked. So the rows are grouped by the
 * date in their `startTime`, the daytime row supplies the condition and the
 * high, and the night row supplies the low.
 *
 * A date whose daytime row has already passed — asking in the evening — still
 * produces a day, built from the night row alone. That is the honest answer: the
 * station cannot forecast a high for an afternoon that is over.
 */
export function parseNwsForecast(data: unknown, wanted: number): WeatherDay[] {
    const byDate = new Map<string, WeatherDay>();

    for (const period of periodsOf(data)) {
        const date = text(field(period, 'startTime'))?.slice(0, 10);
        if (date === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

        const daytime = field(period, 'isDaytime') === true;
        const temperature = reading(field(period, 'temperature'));
        const existing = byDate.get(date);

        // The daytime row is the one that DESCRIBES the day, so it overwrites
        // whatever a night row put there. A date seen only at night keeps its
        // night row's description, which is better than the day saying nothing.
        const described = daytime || existing === undefined ? { ...existing, date, ...conditionsOf(period) } : existing;

        byDate.set(date, {
            ...described,
            ...optional('highC', daytime ? temperature : described.highC),
            ...optional('lowC', daytime ? described.lowC : temperature),
        });
    }

    return [...byDate.values()].slice(0, wanted);
}

/** The measurements a period carries, however it is being used. */
function conditionsOf(period: unknown): WeatherConditions {
    const icon = conditionFromNwsIcon(field(period, 'icon'));

    return {
        // `cloudy` is the fallback rather than a guess at the words, for
        // `conditionFromWmoCode`'s reason: it is the condition that promises the
        // least, and the service's own sentence survives beside it.
        condition: icon ?? 'cloudy',
        ...optional('description', text(field(period, 'shortForecast'))?.toLowerCase()),
        ...optional('temperatureC', reading(field(period, 'temperature'))),
        ...optional('windKph', windKph(field(period, 'windSpeed'))),
        ...optional('precipitationChance', percentage(field(field(period, 'probabilityOfPrecipitation'), 'value'))),
    };
}

const periodsOf = (data: unknown): unknown[] => {
    const periods = field(field(data, 'properties'), 'periods');
    return Array.isArray(periods) ? periods : [];
};

/**
 * `16 km/h` or `10 to 15 km/h`, as a number.
 *
 * The one field this service sends as prose rather than as a figure. A range
 * takes its first number, which is the one the forecast is most confident about.
 * Under `units=si` the unit is always km/h, so it is not parsed — but a response
 * that somehow came back in mph would be caught by the unit check rather than
 * silently reported as a low wind.
 */
export function windKph(value: unknown): number | undefined {
    const spoken = text(value);
    if (spoken === undefined) return undefined;
    if (!/km\/h/i.test(spoken)) return undefined;

    const first = /-?\d+(?:\.\d+)?/.exec(spoken);
    return first === null ? undefined : reading(Number(first[0]));
}

/** Four decimals, which is what the service accepts and rather more than a town needs. */
const round = (value: number): string => String(Math.round(value * 10_000) / 10_000);
