import type { Topic } from '#modules/topics/topic.js';
import type { StationUnits } from './weather.keys.js';

/**
 * What a location topic MEANS, as opposed to how it is edited.
 *
 * `weather.topic.kind.ts` is the form; this is the only code allowed to read a
 * weather topic's `config`, which is the chassis's own rule — nothing generic
 * ever looks inside that column, because a shared schema would be a shape nobody
 * is in a position to define.
 */
export interface WeatherLocation {
    /** The slug a format-clock band and a model both name this by. */
    key: string;
    /** What the station SAYS. The operator's own word for the place. */
    label: string;
    /** What gets looked up, which is frequently more precise than the label. */
    place: string;
    /** Absent means "as the station does", which is what nearly every row wants. */
    units?: StationUnits;
}

/**
 * One topic row, as a place something can be asked about.
 *
 * `undefined` for a row with no place in it, which is a location an operator
 * started and did not finish. Dropped rather than defaulted to the label: a label
 * is what the station says out loud and is frequently not a name any service
 * would find, so looking it up would produce the weather somewhere else and
 * announce it confidently.
 */
export function weatherLocation(topic: Topic): WeatherLocation | undefined {
    const place = text(topic.config.place);
    if (place === undefined) return undefined;

    const units = readUnits(topic.config.units);
    return { key: topic.key, label: topic.label, place, ...(units === undefined ? {} : { units }) };
}

/** Every finished location, in the operator's own order. */
export const weatherLocations = (topics: readonly Topic[]): WeatherLocation[] =>
    topics.map(weatherLocation).filter((location): location is WeatherLocation => location !== undefined);

/**
 * The override, when the row sets one.
 *
 * `undefined` for the empty string the form stores for "as the station does", and
 * for anything unrecognised — which is the same lenient read `parseUnits` does
 * one level up, and for the same reason: a value nobody can parse is a setting
 * nobody set.
 */
function readUnits(value: unknown): StationUnits | undefined {
    const said = text(value)?.toLowerCase();
    return said === 'metric' || said === 'imperial' ? said : undefined;
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined);
