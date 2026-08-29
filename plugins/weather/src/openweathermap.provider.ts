import type { WeatherConditions, WeatherDay, WeatherReading } from '@deadair/plugin-sdk';
import { conditionFromOpenWeatherId } from './weather.codes.js';
import { fetchJson, type Service } from './weather.http.js';
import { field, kphFromMetresPerSecond, localDate, localInstant, optional, percentage, reading, text } from './weather.values.js';
import type { GeoPoint } from './weather.geocode.js';
import { MAX_FORECAST_DAYS, OPENWEATHERMAP_HOST, REQUEST_TIMEOUT_MS } from './weather.manifest.js';

/**
 * OpenWeatherMap: the arm for an operator who already holds a key.
 *
 * It has its own geocoder, so unlike the National Weather Service arm it does
 * not borrow Open-Meteo's: a service is better at finding places in its own
 * index, and the key is already paid for.
 *
 * Three things about it are worth knowing before changing anything here.
 *
 * **This uses the endpoints the free tier actually includes.** `/data/2.5/weather`
 * for current conditions and `/data/2.5/forecast` for the outlook. The tidier One
 * Call endpoint answers both in one request and is a separate subscription, which
 * would make this arm useless to exactly the operators it exists for.
 *
 * **`units=metric` gets Celsius and METRES PER SECOND.** The temperature is what
 * the capability asks for and the wind is not, so every wind figure here goes
 * through {@link kphFromMetresPerSecond}. This is the single easiest thing in the
 * plugin to get wrong, and the failure is a station reporting a gale as a breeze.
 *
 * **The forecast is three-hourly, not daily.** Forty entries of three hours each,
 * which is what {@link parseOpenWeatherForecast} folds into calendar days at the
 * place's own offset.
 */

/** OpenWeatherMap's own geocoder, which is the one this arm uses. */
export async function openWeatherGeocode(service: Service, apiKey: string, place: string): Promise<GeoPoint | undefined> {
    const asked = place.trim();
    if (asked.length === 0 || apiKey.length === 0) return undefined;

    const url = new URL(`https://${OPENWEATHERMAP_HOST}/geo/1.0/direct`);
    url.searchParams.set('q', asked);
    url.searchParams.set('limit', '1');
    url.searchParams.set('appid', apiKey);

    return parseOpenWeatherGeocoding(
        await fetchJson(service, url.toString(), { name: 'OpenWeatherMap', timeoutMs: REQUEST_TIMEOUT_MS, hint: wrongKey }),
    );
}

/** A 401 here is always the key, and the status alone does not say so to an operator. */
const wrongKey = (status: number): string | undefined => (status === 401 ? 'which is what a wrong or not-yet-active key looks like' : undefined);

/** The geocoder's array, as a point. An empty array is a place nothing matched. */
export function parseOpenWeatherGeocoding(data: unknown): GeoPoint | undefined {
    if (!Array.isArray(data)) return undefined;

    const first = data[0];
    const latitude = field(first, 'lat');
    const longitude = field(first, 'lon');
    const name = text(field(first, 'name'));

    if (typeof latitude !== 'number' || typeof longitude !== 'number' || name === undefined) return undefined;

    const area = text(field(first, 'state')) ?? text(field(first, 'country'));
    return {
        name: area === undefined || area.toLowerCase() === name.toLowerCase() ? name : `${name}, ${area}`,
        latitude,
        longitude,
    };
}

/** What it is like, in one request for now and one more for the outlook. */
export async function openWeatherRead(service: Service, apiKey: string, point: GeoPoint, days: number): Promise<WeatherReading | undefined> {
    const now = parseOpenWeatherCurrent(await ask(service, apiKey, 'weather', point), point.name);
    if (now === undefined) return undefined;

    const wanted = Math.min(Math.max(0, Math.trunc(days)), MAX_FORECAST_DAYS);
    if (wanted === 0) return now;

    const forecast = parseOpenWeatherForecast(await ask(service, apiKey, 'forecast', point), wanted);
    return { ...now, ...(forecast.length === 0 ? {} : { days: forecast }) };
}

async function ask(service: Service, apiKey: string, endpoint: 'weather' | 'forecast', point: GeoPoint): Promise<unknown> {
    const url = new URL(`https://${OPENWEATHERMAP_HOST}/data/2.5/${endpoint}`);
    url.searchParams.set('lat', String(point.latitude));
    url.searchParams.set('lon', String(point.longitude));
    // Celsius. The wind that comes with it is metres per second, which is
    // converted on the way out rather than left as a trap for the next reader.
    url.searchParams.set('units', 'metric');
    url.searchParams.set('appid', apiKey);

    return await fetchJson(service, url.toString(), { name: 'OpenWeatherMap', timeoutMs: REQUEST_TIMEOUT_MS, hint: wrongKey });
}

/** The current-conditions response, as a reading with no forecast on it yet. */
export function parseOpenWeatherCurrent(data: unknown, place: string): WeatherReading | undefined {
    const offset = offsetOf(data);
    const observedAt = localInstant(field(data, 'dt'), offset);
    if (observedAt === undefined) return undefined;

    const main = field(data, 'main');
    const conditions: WeatherConditions = {
        ...describe(field(data, 'weather')),
        ...optional('temperatureC', reading(field(main, 'temp'))),
        ...optional('feelsLikeC', reading(field(main, 'feels_like'))),
        ...optional('humidity', percentage(field(main, 'humidity'))),
        ...optional('windKph', kphFromMetresPerSecond(field(field(data, 'wind'), 'speed'))),
    };

    // The service's own name for the point is preferred where it has one: it is
    // the same city the geocoder found, spelled as the forecast service spells
    // it, and disagreement between the two is worth being able to see.
    return { place: text(field(data, 'name')) ?? place, observedAt, current: conditions };
}

/**
 * The three-hourly list, as calendar days at the place.
 *
 * Folded rather than sampled: a day's high is the highest figure across its
 * entries and its low the lowest, because the entry nearest noon is not reliably
 * the warmest and picking one would report a cold morning as the day.
 *
 * The CONDITION comes from the entry nearest the middle of the day, which is the
 * one thing sampling is right for — a day is described by its afternoon, and
 * folding conditions would mean deciding whether four hours of drizzle beats two
 * of sun.
 */
export function parseOpenWeatherForecast(data: unknown, wanted: number): WeatherDay[] {
    const list = field(data, 'list');
    if (!Array.isArray(list)) return [];

    const offset = offsetOf(field(data, 'city'));
    const byDate = new Map<string, DayBuilder>();

    for (const entry of list) {
        const date = localDate(field(entry, 'dt'), offset);
        if (date === undefined) continue;

        const builder = byDate.get(date) ?? { date, hour: -1 };
        const main = field(entry, 'main');

        builder.high = higher(builder.high, reading(field(main, 'temp_max')) ?? reading(field(main, 'temp')));
        builder.low = lower(builder.low, reading(field(main, 'temp_min')) ?? reading(field(main, 'temp')));
        builder.chance = higher(builder.chance, percentage(fraction(field(entry, 'pop'))));
        builder.wind = higher(builder.wind, kphFromMetresPerSecond(field(field(entry, 'wind'), 'speed')));

        // Nearest to one in the afternoon, which is the entry a person would
        // point at if asked what a day was like.
        const hour = Number(localInstant(field(entry, 'dt'), offset)?.slice(11, 13) ?? NaN);
        if (Number.isFinite(hour) && (builder.hour < 0 || Math.abs(hour - 13) < Math.abs(builder.hour - 13))) {
            builder.hour = hour;
            builder.described = describe(field(entry, 'weather'));
        }

        byDate.set(date, builder);
    }

    return [...byDate.values()].slice(0, wanted).map(built);
}

/** One day being assembled out of the entries that fall in it. */
interface DayBuilder {
    date: string;
    /** The hour of the entry that supplied {@link described}. `-1` until one has. */
    hour: number;
    described?: Pick<WeatherConditions, 'condition' | 'description'>;
    high?: number;
    low?: number;
    chance?: number;
    wind?: number;
}

const built = (builder: DayBuilder): WeatherDay => ({
    date: builder.date,
    condition: builder.described?.condition ?? 'cloudy',
    ...optional('description', builder.described?.description),
    ...optional('highC', builder.high),
    ...optional('lowC', builder.low),
    ...optional('windKph', builder.wind),
    ...optional('precipitationChance', builder.chance),
});

/** The `weather` array's first entry, which is the only one any of these responses carries. */
function describe(weather: unknown): Pick<WeatherConditions, 'condition' | 'description'> {
    const first = Array.isArray(weather) ? weather[0] : undefined;
    return {
        condition: conditionFromOpenWeatherId(field(first, 'id')),
        ...optional('description', text(field(first, 'description'))),
    };
}

/**
 * The place's offset from UTC in seconds.
 *
 * Named `timezone` in this API and holding a number of seconds rather than a zone
 * name, which is worth stating because every other service that says `timezone`
 * means `Europe/London`.
 */
const offsetOf = (data: unknown): number => {
    const offset = field(data, 'timezone');
    return typeof offset === 'number' && Number.isFinite(offset) ? offset : 0;
};

/** `pop` is a share between 0 and 1; the capability wants a percentage. */
const fraction = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value * 100 : undefined);

const higher = (current: number | undefined, candidate: number | undefined): number | undefined =>
    candidate === undefined ? current : current === undefined ? candidate : Math.max(current, candidate);

const lower = (current: number | undefined, candidate: number | undefined): number | undefined =>
    candidate === undefined ? current : current === undefined ? candidate : Math.min(current, candidate);
