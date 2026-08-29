import type { WeatherConditions, WeatherDay, WeatherReading } from '@deadair/plugin-sdk';
import { conditionFromWmoCode, describeWmoCode } from './weather.codes.js';
import { fetchJson, type Service } from './weather.http.js';
import { field, optional, percentage, reading, withOffset } from './weather.values.js';
import type { GeoPoint } from './weather.geocode.js';
import { MAX_FORECAST_DAYS, OPEN_METEO_HOST, REQUEST_TIMEOUT_MS } from './weather.manifest.js';

/**
 * Open-Meteo: the keyless one, and the default.
 *
 * One request answers the whole reading — current conditions and the forecast
 * together — which is why it is the arm to reach for when a break is waiting.
 * The other two need three or four.
 *
 * Two things about the request are load-bearing.
 *
 * **`timezone=auto` is what makes a forecast DAY mean anything.** Without it the
 * daily rows are UTC days, so "tomorrow" for a station in Auckland is a forecast
 * that ends at lunchtime. With it, the response also carries
 * `utc_offset_seconds`, which is what turns the service's local timestamps back
 * into unambiguous instants — see {@link withOffset}.
 *
 * **The units are the defaults, deliberately.** Open-Meteo answers in Celsius,
 * km/h and millimetres unless told otherwise, and those are exactly what the
 * capability asks for, so this arm names no unit parameter at all. Saying it
 * would be one more thing to keep in step with `capabilities/weather.ts`.
 */
export async function openMeteoRead(service: Service, point: GeoPoint, days: number): Promise<WeatherReading | undefined> {
    const url = new URL(`https://${OPEN_METEO_HOST}/v1/forecast`);
    url.searchParams.set('latitude', String(point.latitude));
    url.searchParams.set('longitude', String(point.longitude));
    url.searchParams.set('current', CURRENT_FIELDS.join(','));
    url.searchParams.set('timezone', 'auto');

    // `forecast_days=1` still returns today, which is what a caller asking for
    // none wants left out — so the daily block is requested only when it was
    // asked for, and dropped from the answer otherwise.
    const wanted = Math.min(Math.max(0, Math.trunc(days)), MAX_FORECAST_DAYS);
    if (wanted > 0) {
        url.searchParams.set('daily', DAILY_FIELDS.join(','));
        url.searchParams.set('forecast_days', String(wanted));
    }

    return parseOpenMeteoForecast(await fetchJson(service, url.toString(), { name: 'Open-Meteo', timeoutMs: REQUEST_TIMEOUT_MS }), point.name);
}

const CURRENT_FIELDS = ['temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'precipitation', 'weather_code', 'wind_speed_10m'] as const;

const DAILY_FIELDS = [
    'weather_code',
    'temperature_2m_max',
    'temperature_2m_min',
    'precipitation_probability_max',
    'wind_speed_10m_max',
    'sunrise',
    'sunset',
] as const;

/**
 * Open-Meteo's JSON, as a reading.
 *
 * Pure and exported separately from the request, so a saved response pins the
 * mapping with no host in the way. Tolerant of anything: a shape it does not
 * recognise yields `undefined` rather than a throw, because the alternative is
 * one field rename upstream taking the station's whole ability to say what it is
 * like outside.
 *
 * The daily block is COLUMNAR — parallel arrays, one per field, indexed by day —
 * which is the one thing about this response that does not read like the others.
 */
export function parseOpenMeteoForecast(data: unknown, place: string): WeatherReading | undefined {
    const current = field(data, 'current');
    if (current === undefined) return undefined;

    const offset = typeof field(data, 'utc_offset_seconds') === 'number' ? (field(data, 'utc_offset_seconds') as number) : 0;
    const observedAt = withOffset(field(current, 'time'), offset);
    if (observedAt === undefined) return undefined;

    const code = field(current, 'weather_code');
    const now: WeatherConditions = {
        condition: conditionFromWmoCode(code),
        ...optional('description', describeWmoCode(code)),
        ...optional('temperatureC', reading(field(current, 'temperature_2m'))),
        ...optional('feelsLikeC', reading(field(current, 'apparent_temperature'))),
        ...optional('windKph', reading(field(current, 'wind_speed_10m'))),
        ...optional('humidity', percentage(field(current, 'relative_humidity_2m'))),
    };

    const days = parseDaily(field(data, 'daily'), offset);

    return { place, observedAt, current: now, ...(days.length === 0 ? {} : { days }) };
}

/** The columnar daily block, as rows. */
function parseDaily(daily: unknown, offset: number): WeatherDay[] {
    const dates = field(daily, 'time');
    if (!Array.isArray(dates)) return [];

    const codes = column(daily, 'weather_code');
    const highs = column(daily, 'temperature_2m_max');
    const lows = column(daily, 'temperature_2m_min');
    const chances = column(daily, 'precipitation_probability_max');
    const winds = column(daily, 'wind_speed_10m_max');
    const sunrises = column(daily, 'sunrise');
    const sunsets = column(daily, 'sunset');

    const rows: WeatherDay[] = [];
    for (const [index, date] of dates.entries()) {
        // A date is the only field a day cannot do without: everything else is
        // optional in the capability, and a row with no date has nothing to say
        // which day it is about.
        if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

        const code = codes[index];
        rows.push({
            date,
            condition: conditionFromWmoCode(code),
            ...optional('description', describeWmoCode(code)),
            ...optional('highC', reading(highs[index])),
            ...optional('lowC', reading(lows[index])),
            ...optional('windKph', reading(winds[index])),
            ...optional('precipitationChance', percentage(chances[index])),
            ...optional('sunrise', withOffset(sunrises[index], offset)),
            ...optional('sunset', withOffset(sunsets[index], offset)),
        });
    }

    return rows;
}

const column = (daily: unknown, key: string): unknown[] => {
    const values = field(daily, key);
    return Array.isArray(values) ? values : [];
};
