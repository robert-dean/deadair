/**
 * Smart shuffle: records the station aired lately are less likely to come round again soon.
 *
 * ## The bubble this answers
 *
 * The repeat window and the artist cooldown are FILTERS, and a filter has nothing to say about the
 * far side of itself. Past the window, a record aired four days ago and one never aired at all are
 * drawn with identical probability, so on a library of any size the station ends up sounding like it
 * owns two hundred songs while every individual choice is legal
 * ([station-intelligence](https://github.com/robert-dean/deadair/discussions/37) §5). Spotify shipped
 * the same fix for the same complaint as "fewer repeats" shuffle in November 2025.
 *
 * ## A bias, never a filter
 *
 * Freshness TILTS the draw and never decides it. A filter that preferred unaired records would starve
 * a small library and fight the rotation rules for authority over what may air; a weight does
 * neither, and a library of forty records still plays all forty. `weightOf` in `rotation.rules.ts`
 * is where the number meets the draw, beside the like-doubling it composes with.
 *
 * ## Keyed on the song
 *
 * Through `play_history.song_key`, the identity every rotation rule reads (see `rotation.keys.ts`).
 * A discovered copy of a record the library already held is a new catalog row and the same work, and
 * it is exactly as stale as the copy that aired.
 */

import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { DateTime } from 'luxon';
import { settingIsOn } from '#modules/shared/setting.flags.js';
import { numberFrom } from '#modules/shared/setting.numbers.js';
import { PLAY_HISTORY_RETENTION_DAYS } from './play.history.repository.js';

/** The `deadair.settings` keys. In the `rotation` group, because that is where an operator looks for how often things repeat. */
export const SMART_SHUFFLE_KEYS = {
    enabled: 'rotation.smartShuffle',
    days: 'rotation.smartShuffleDays',
} as const;

/**
 * On unless an operator says otherwise, as Spotify ships it.
 *
 * Off is not a safer station, it is the bubble: the draw it restores is the one that treats a record
 * aired on Tuesday and one never aired as the same. Turning it off restores that draw exactly, so an
 * operator who preferred it loses nothing by the default.
 */
export const DEFAULT_SMART_SHUFFLE = true;

/**
 * How many days a record takes to warm back up after it airs: a fortnight.
 *
 * The figure #37 arrived at. Long enough to be felt past a three-day repeat window, short enough that
 * a modest library has most of itself fully fresh at any one time.
 */
export const DEFAULT_SMART_SHUFFLE_DAYS = 14;

/**
 * The range the resolver clamps a stored horizon to, and the registry declares so the console refuses
 * the same figures. The ceiling is the history's own retention: a record aired longer ago than rows
 * are kept for is indistinguishable from one never aired, so a longer horizon would describe history
 * nobody holds.
 */
export const SMART_SHUFFLE_DAYS_RANGE = { min: 1, max: PLAY_HISTORY_RETENTION_DAYS } as const;

/** What the smart shuffle is set to, read once per decision rather than held. */
export interface SmartShuffle {
    enabled: boolean;
    /** Whole days, inside {@link SMART_SHUFFLE_DAYS_RANGE}. Meaningful only when enabled. */
    horizonDays: number;
}

/**
 * A stored horizon as the draw will use it: whole days, clamped into range.
 *
 * Clamped rather than refused, on the settings rule: this reads a row that is already stored, and a
 * setting that refuses to load leaves the draw without an answer. Whole days because the history
 * query floors its interval, and the two have to agree about what they are measuring.
 */
export function clampSmartShuffleDays(value: unknown): number {
    const parsed = Math.floor(numberFrom(value, DEFAULT_SMART_SHUFFLE_DAYS));
    return Math.min(SMART_SHUFFLE_DAYS_RANGE.max, Math.max(SMART_SHUFFLE_DAYS_RANGE.min, parsed));
}

/** The smart shuffle as the operator has it set. Through `settingIsOn`, because a setting is a string. */
export function resolveSmartShuffle(config: AppConfig): SmartShuffle {
    return {
        enabled: settingIsOn(config, SMART_SHUFFLE_KEYS.enabled, DEFAULT_SMART_SHUFFLE),
        horizonDays: clampSmartShuffleDays(config.get(SMART_SHUFFLE_KEYS.days, DEFAULT_SMART_SHUFFLE_DAYS)),
    };
}

/**
 * How many days of history to ask for: the horizon when on, `0` when off.
 *
 * `0` is what makes the history reads answer empty without querying, so a station with this off pays
 * nothing for its existence.
 */
export const historyDaysFor = (shuffle: SmartShuffle): number => (shuffle.enabled ? shuffle.horizonDays : 0);

/**
 * How fresh a record is, from 0 (aired this instant) to 1 (a horizon ago or longer, or never).
 *
 * A straight ramp. Anything cleverer would be a curve nobody could state out loud, and the whole
 * rotation is built from rules an operator could.
 *
 * @param lastAiredAt - When the song last aired, or undefined when history has no airing inside the horizon.
 * @param now - Passed in rather than read, so the answer is table-testable.
 */
export function freshnessOf(lastAiredAt: DateTime | undefined, now: DateTime, horizonDays: number): number {
    if (lastAiredAt === undefined || horizonDays <= 0) return 1;

    const days = now.diff(lastAiredAt, 'days').days;
    // A clock that has the airing in the future reads as just aired, which is the cautious answer.
    if (!Number.isFinite(days)) return 1;
    return Math.min(1, Math.max(0, days / horizonDays));
}
