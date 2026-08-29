import type { WeatherCondition, WeatherConditions, WeatherDay, WeatherReading } from '@deadair/plugin-sdk';
import { DEFAULT_UNITS, type StationUnits } from './weather.keys.js';

/**
 * Turning a reading into what this station would say about it.
 *
 * ## The conversion lives here and not in a plugin
 *
 * `capabilities/weather.ts` is metric on the wire, always, and this is the one
 * place that changes. The reason is that what a station SAYS is a fact about the
 * station rather than about whichever service answered: a British station says
 * Celsius whether its reading came from Open-Meteo or from OpenWeatherMap, and a
 * plugin that converted would make the units on the wire depend on which plugin
 * happened to be installed.
 *
 * It is `ConfigField.unit`'s rule one layer down, and the practical consequence
 * is that everything in this file is a pure function with tests, because
 * arithmetic that only runs on air is arithmetic nobody checks.
 *
 * ## The words are adjectives, not nouns
 *
 * `conditionWords` answers `raining` rather than `rain`, because every caller is
 * building a sentence that starts "it's". A noun would make every one of them
 * write the same join, and the two that got it wrong would say "it's rain".
 */

/** A reading with every figure in the units this station uses. */
export interface SpokenWeather {
    /** The place, as the service resolved it. */
    place: string;
    /** ISO-8601, as the plugin gave it. Unconverted: an instant has no units. */
    observedAt: string;
    units: StationUnits;
    current: SpokenConditions;
    days?: SpokenDay[];
}

/** One moment's figures, converted, plus the words for the sky. */
export interface SpokenConditions {
    condition: WeatherCondition;
    /** What the sky is doing, as an adjective a sentence can follow "it's" with. */
    words: string;
    /** The service's own phrase, unconverted and unread by anything deterministic. */
    description?: string;
    /** Degrees, in {@link SpokenWeather.units}. */
    temperature?: number;
    feelsLike?: number;
    /** Kilometres or miles per hour, in {@link SpokenWeather.units}. */
    wind?: number;
    humidity?: number;
    precipitationChance?: number;
}

/** One forecast day's figures, converted. */
export interface SpokenDay extends SpokenConditions {
    date: string;
    high?: number;
    low?: number;
    sunrise?: string;
    sunset?: string;
}

/** What a degree is called here, for a caller writing it down rather than saying it. */
export const degreeLabel = (units: StationUnits): string => (units === 'imperial' ? '°F' : '°C');

/** What a wind speed is called here. */
export const speedLabel = (units: StationUnits): string => (units === 'imperial' ? 'mph' : 'km/h');

/**
 * Celsius as this station's degrees.
 *
 * Rounded to a whole number, unlike the plugin's one decimal, because this is the
 * figure that gets said: nobody has ever heard a station announce 17.4 degrees.
 */
export function temperature(celsius: number | undefined, units: StationUnits): number | undefined {
    if (celsius === undefined) return undefined;
    return Math.round(units === 'imperial' ? celsius * 1.8 + 32 : celsius);
}

/** Kilometres per hour as this station's wind speed, to a whole number for the same reason. */
export function speed(kph: number | undefined, units: StationUnits): number | undefined {
    if (kph === undefined) return undefined;
    return Math.round(units === 'imperial' ? kph / 1.609_344 : kph);
}

/**
 * What the sky is doing, as an adjective.
 *
 * The SDK's ten words in the station's own English. `hail` is `hailing` rather
 * than "thundery with hail", because the plugin that produced it kept the
 * service's own sentence in `description` and a model that wants the whole story
 * has it there.
 */
export function conditionWords(condition: WeatherCondition): string {
    return CONDITION_WORDS[condition];
}

const CONDITION_WORDS: Record<WeatherCondition, string> = {
    clear: 'clear',
    cloudy: 'cloudy',
    overcast: 'overcast',
    fog: 'foggy',
    drizzle: 'drizzling',
    rain: 'raining',
    snow: 'snowing',
    sleet: 'sleeting',
    thunderstorm: 'thundery',
    hail: 'hailing',
};

/** A whole reading, in this station's units. */
export function spoken(reading: WeatherReading, units: StationUnits = DEFAULT_UNITS): SpokenWeather {
    return {
        place: reading.place,
        observedAt: reading.observedAt,
        units,
        current: spokenConditions(reading.current, units),
        ...(reading.days === undefined || reading.days.length === 0 ? {} : { days: reading.days.map(day => spokenDay(day, units)) }),
    };
}

function spokenConditions(conditions: WeatherConditions, units: StationUnits): SpokenConditions {
    return {
        condition: conditions.condition,
        words: conditionWords(conditions.condition),
        ...only('description', conditions.description),
        ...only('temperature', temperature(conditions.temperatureC, units)),
        ...only('feelsLike', temperature(conditions.feelsLikeC, units)),
        ...only('wind', speed(conditions.windKph, units)),
        ...only('humidity', conditions.humidity),
        ...only('precipitationChance', conditions.precipitationChance),
    };
}

function spokenDay(day: WeatherDay, units: StationUnits): SpokenDay {
    return {
        ...spokenConditions(day, units),
        date: day.date,
        ...only('high', temperature(day.highC, units)),
        ...only('low', temperature(day.lowC, units)),
        ...only('sunrise', day.sunrise),
        ...only('sunset', day.sunset),
    };
}

/** `undefined` means "not set", so the key is left off rather than written with nothing behind it. */
const only = <TKey extends string, TValue>(key: TKey, value: TValue | undefined): Partial<Record<TKey, TValue>> =>
    value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
