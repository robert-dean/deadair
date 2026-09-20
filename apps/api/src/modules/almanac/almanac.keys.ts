import type { AlmanacLean } from './almanac.lean.js';

/**
 * The station settings this module reads.
 *
 * In the `rotation.` namespace rather than `station.`, which is the split
 * `weather.keys.ts` describes from the other side: `station.location` is a fact
 * about where the station IS, and this is a decision about what it SAYS, beside
 * the bulletin's roster and the phrasings.
 *
 * Declared in `settings.registry.ts` and read here, which is the split every
 * module keeps: the registry owns the form and the defaults, and the typed
 * resolver lives beside the code that acts on it.
 */
export const ALMANAC_KEYS = {
    /** How the station leans when it reads the day out. See {@link parseLean}. */
    lean: 'rotation.almanacLean',
} as const;

/**
 * What a music station does with a day of general history, when the operator
 * has not said.
 *
 * Musicians first and everything else behind them, because the alternative
 * defaults are both worse on a real calendar: reading the day as it comes makes
 * a music station announce parliamentary acts, and reading only the musicians
 * makes it silent on the days that have none. See `almanac.lean.ts`.
 */
export const DEFAULT_LEAN: AlmanacLean = 'music';

/**
 * The lean a stored value names, whatever it actually holds.
 *
 * **A setting is a STRING**, so this compares text and never reads a row as an
 * enum the config layer does not have. Anything unrecognised takes the default
 * rather than the narrowest option, on `settingIsOn`'s rule: a value nobody can
 * parse is a setting nobody set, and the narrowest option here is the one that
 * can silence the feature.
 */
export function parseLean(value: string | undefined): AlmanacLean {
    const said = value?.trim().toLowerCase();
    if (said === 'musiconly') return 'musicOnly';
    if (said === 'any') return 'any';
    return DEFAULT_LEAN;
}
