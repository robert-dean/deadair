/**
 * The station settings this module reads.
 *
 * In the `station.` namespace beside `station.timezone` and `station.djName`,
 * because both of these are facts about the station rather than about the
 * weather: where it is, and which units its listeners think in. A station that
 * later grows a second use for either — an occasion calendar, a distance read out
 * in a travel bulletin — reads the same two rows.
 *
 * Declared in `settings.registry.ts` and read here, which is the split every
 * module keeps: the registry owns the form and the defaults, and the typed
 * resolver lives beside the code that acts on it.
 */
export const WEATHER_KEYS = {
    /**
     * Where the station is, as a place name something can resolve.
     *
     * The default location for anything about the weather, and the whole reason a
     * fresh install can report its own conditions without the operator creating a
     * topic first. Blank is an ordinary state and means the station has no default
     * place — every weather feature then declines rather than guessing.
     */
    location: 'station.location',
    /** Whether this station's listeners think in Celsius or in Fahrenheit. */
    units: 'station.units',
} as const;

/**
 * What a station says its measurements in.
 *
 * The capability is metric on the wire, always, and this is the only place the
 * station decides what to do about that. See `weather.words.ts`.
 */
export type StationUnits = 'metric' | 'imperial';

export const DEFAULT_UNITS: StationUnits = 'metric';

/**
 * The units a stored value names, whatever it actually holds.
 *
 * **A setting is a STRING**, so this compares text and never reads a row as an
 * enum the config layer does not have. Anything unrecognised takes the default
 * rather than being treated as imperial, on `settingIsOn`'s rule: a value nobody
 * can parse is a setting nobody set.
 */
export function parseUnits(value: string | undefined): StationUnits {
    return value?.trim().toLowerCase() === 'imperial' ? 'imperial' : DEFAULT_UNITS;
}
