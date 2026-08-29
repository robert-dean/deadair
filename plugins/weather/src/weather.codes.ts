import type { WeatherCondition } from '@deadair/plugin-sdk';

/**
 * Three services' condition schemes, collapsed onto the SDK's ten words.
 *
 * This file is the per-service quirk the `weather` capability exists to absorb.
 * WMO code 73, an icon path segment of `snow`, and the number 601 are three
 * spellings of the same weather, and the station is entitled to learn one word
 * for it. Everything here is pure and tested against the published tables, since
 * a mapping is the one part of a weather plugin that can be wrong without any
 * request failing.
 *
 * ## What is deliberately thrown away
 *
 * Intensity. `light`, `moderate` and `heavy` all arrive as the same word, because
 * the SDK's vocabulary is about WHAT is falling and how much is a number the
 * caller can read for itself. Keeping three arms per condition would have been
 * thirty words nobody can say differently on air.
 *
 * ## What is deliberately kept
 *
 * The service's own sentence, which every caller here passes through as
 * `description`. A model reading "freezing drizzle" is better off than one
 * reading `sleet`, and the mapping is what stops a deterministic writer having to
 * understand either.
 */

/**
 * WMO 4677 weather codes, as Open-Meteo reports them.
 *
 * The one judgement call is 96 and 99, "thunderstorm with hail". Both are
 * thunderstorms and both are reported as `hail`, because hail is the part a
 * listener has never heard the station mention and the thunder survives in the
 * description either way. Without this, `hail` would be a word in the SDK's
 * vocabulary that no service could ever produce.
 */
export function conditionFromWmoCode(code: unknown): WeatherCondition {
    if (typeof code !== 'number' || !Number.isFinite(code)) return 'cloudy';

    switch (Math.trunc(code)) {
        case 0:
            return 'clear';
        case 1:
        case 2:
            return 'cloudy';
        case 3:
            return 'overcast';
        case 45:
        case 48:
            return 'fog';
        case 51:
        case 53:
        case 55:
            return 'drizzle';
        // Freezing drizzle and freezing rain: falling as liquid and arriving as
        // ice, which is what `sleet` is for here.
        case 56:
        case 57:
        case 66:
        case 67:
            return 'sleet';
        case 61:
        case 63:
        case 65:
        case 80:
        case 81:
        case 82:
            return 'rain';
        case 71:
        case 73:
        case 75:
        case 77:
        case 85:
        case 86:
            return 'snow';
        case 95:
            return 'thunderstorm';
        case 96:
        case 99:
            return 'hail';
        default:
            return 'cloudy';
    }
}

/** The words Open-Meteo does not send, so the station has something to read out of a bare code. */
export function describeWmoCode(code: unknown): string | undefined {
    if (typeof code !== 'number' || !Number.isFinite(code)) return undefined;
    return WMO_WORDS[Math.trunc(code)];
}

const WMO_WORDS: Record<number, string> = {
    0: 'clear sky',
    1: 'mainly clear',
    2: 'partly cloudy',
    3: 'overcast',
    45: 'fog',
    48: 'freezing fog',
    51: 'light drizzle',
    53: 'drizzle',
    55: 'heavy drizzle',
    56: 'light freezing drizzle',
    57: 'freezing drizzle',
    61: 'light rain',
    63: 'rain',
    65: 'heavy rain',
    66: 'light freezing rain',
    67: 'freezing rain',
    71: 'light snow',
    73: 'snow',
    75: 'heavy snow',
    77: 'snow grains',
    80: 'light showers',
    81: 'showers',
    82: 'heavy showers',
    85: 'light snow showers',
    86: 'snow showers',
    95: 'thunderstorms',
    96: 'thunderstorms with hail',
    99: 'thunderstorms with heavy hail',
};

/**
 * A National Weather Service icon URL, as a condition.
 *
 * The service has no condition CODE at all: what it publishes is a sentence
 * ("Chance Rain Showers then Mostly Cloudy") and an icon URL whose path carries a
 * token from a closed set. The token is what is read here, because a sentence is
 * a thing to say and a token is a thing to switch on, and the tokens are stable
 * where the sentences are written afresh by each forecast office.
 *
 * A URL looks like `https://api.weather.gov/icons/land/day/tsra,40?size=medium`,
 * and the token may be a comma-joined pair with a chance percentage, or a slash
 * -joined pair for a period whose weather changes. The FIRST token wins, since
 * that is the one the period starts in.
 */
export function conditionFromNwsIcon(icon: unknown): WeatherCondition | undefined {
    if (typeof icon !== 'string' || icon.trim().length === 0) return undefined;

    const segments = (icon.split('?')[0] ?? '').split('/').filter(Boolean);

    // The token is the segment AFTER `day` or `night`, and it matters that this
    // is not simply the last one: a period whose weather changes is written
    // `.../day/rain,60/bkn`, so the last segment is what it clears up to rather
    // than what it starts as.
    const marker = segments.findIndex(segment => segment === 'day' || segment === 'night');
    const first = (marker >= 0 ? segments[marker + 1] : segments.at(-1)) ?? '';

    // `rain,60` -> `rain`. The chance is a field of its own on the period, so it
    // must not become part of the token.
    const token = first.split(',')[0]?.toLowerCase();
    return token === undefined ? undefined : NWS_TOKENS[token];
}

/**
 * The icon vocabulary, from the service's own icon listing.
 *
 * `hot`, `cold`, `wind_*` and the tropical ones describe something other than
 * what is falling out of the sky, so they map to the nearest sky they imply
 * rather than being invented arms in the SDK's vocabulary — a windy clear day is
 * a clear day, and the wind speed is a number the caller already has.
 */
const NWS_TOKENS: Record<string, WeatherCondition> = {
    skc: 'clear',
    few: 'clear',
    sct: 'cloudy',
    bkn: 'cloudy',
    ovc: 'overcast',
    wind_skc: 'clear',
    wind_few: 'clear',
    wind_sct: 'cloudy',
    wind_bkn: 'cloudy',
    wind_ovc: 'overcast',
    fog: 'fog',
    haze: 'fog',
    smoke: 'fog',
    dust: 'fog',
    rain: 'rain',
    rain_showers: 'rain',
    rain_showers_hi: 'rain',
    snow: 'snow',
    blizzard: 'snow',
    rain_snow: 'sleet',
    rain_sleet: 'sleet',
    snow_sleet: 'sleet',
    sleet: 'sleet',
    fzra: 'sleet',
    rain_fzra: 'sleet',
    snow_fzra: 'sleet',
    tsra: 'thunderstorm',
    tsra_sct: 'thunderstorm',
    tsra_hi: 'thunderstorm',
    tornado: 'thunderstorm',
    hurricane: 'rain',
    tropical_storm: 'rain',
    hot: 'clear',
    cold: 'clear',
};

/**
 * An OpenWeatherMap condition id, as a condition.
 *
 * The ids are grouped by leading digit — 2xx thunderstorm, 3xx drizzle, 5xx rain,
 * 6xx snow, 7xx atmosphere, 800 clear, 80x clouds — and the group is almost
 * always enough. The exceptions are inside 6xx, where sleet and rain-and-snow
 * live among the snow codes, and 800 against 801-804, which is one number apart
 * and the difference between a clear sky and an overcast one.
 */
export function conditionFromOpenWeatherId(id: unknown): WeatherCondition {
    if (typeof id !== 'number' || !Number.isFinite(id)) return 'cloudy';

    const code = Math.trunc(id);
    if (code === 800) return 'clear';
    // 801 to 803 is a sky between a tenth and five sixths covered; 804 is the
    // whole of it, which is the only one worth a different word.
    if (code >= 801 && code <= 803) return 'cloudy';
    if (code === 804) return 'overcast';

    // Sleet (611-613) and rain-mixed-with-snow (615, 616) sit inside the snow
    // group, so they are named before the group is.
    if (code >= 611 && code <= 616) return 'sleet';
    if (code >= 600 && code <= 622) return 'snow';

    if (code >= 200 && code <= 232) return 'thunderstorm';
    if (code >= 300 && code <= 321) return 'drizzle';
    if (code >= 500 && code <= 531) return 'rain';
    // 7xx is "atmosphere": mist, smoke, haze, dust, ash, squalls, tornado. Every
    // one of them is something a person cannot see through, which is `fog`.
    if (code >= 701 && code <= 781) return 'fog';

    return 'cloudy';
}
