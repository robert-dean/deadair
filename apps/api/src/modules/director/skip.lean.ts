/**
 * The skip lean: a record the operator cut short with Skip is drawn less often for a while.
 *
 * ## Between a like and a dislike
 *
 * A dislike is an instruction and is permanent: the record never airs again until somebody changes
 * their mind. A Skip is weaker and says more: the operator heard it start and did not want it NOW. That
 * is the station's clearest signal short of a rating, and until `track_skips` (0083) it was thrown away,
 * because `play_history` is written when a record starts and a record cut after ten seconds looked
 * exactly like one heard to the end.
 *
 * So a skipped record is weighed down, and recovers. At the moment of the Skip it is drawn at
 * {@link SKIP_FLOOR} of its weight, rising evenly to full over `rotation.skipLeanDays`. Never zero: a
 * refusal is a dislike's job, and an operator who skipped a record in a bad mood has not banned it.
 *
 * ## Only the operator's Skip
 *
 * `PlayoutService.skip` is the only writer, so a dislike's cut, a changeover's overrun cut and a
 * skip-to never count. Only the draw from the station's own library reads it, as with smart shuffle;
 * a generator that names records cannot be weighted, only judged.
 */

import type { AppConfig } from '@maroonedsoftware/appconfig';
import { settingIsOn } from '#modules/shared/setting.flags.js';
import { numberFrom } from '#modules/shared/setting.numbers.js';

/** The `deadair.settings` keys, in the `rotation` group beside smart shuffle. */
export const SKIP_LEAN_KEYS = {
    enabled: 'rotation.skipLean',
    days: 'rotation.skipLeanDays',
} as const;

/** On by default: off restores the draw exactly, so nothing is lost by it. */
export const DEFAULT_SKIP_LEAN = true;

/** How long a skipped record takes to recover: a fortnight, as smart shuffle's horizon. */
export const DEFAULT_SKIP_LEAN_DAYS = 14;

/**
 * The range the resolver clamps a stored figure to and the registry declares. Two months at most,
 * because a lean that long is a slow dislike, and the operator has a real one for that.
 */
export const SKIP_LEAN_DAYS_RANGE = { min: 1, max: 60 } as const;

/**
 * The share of its weight a record keeps the moment it is skipped. A quarter, smart shuffle's
 * `FRESH_FLOOR` figure and for its reason: low enough to be felt, and never a refusal.
 */
export const SKIP_FLOOR = 0.25;

/** What the skip lean is set to, read once per decision rather than held. */
export interface SkipLean {
    enabled: boolean;
    /** Whole days, inside {@link SKIP_LEAN_DAYS_RANGE}. Meaningful only when enabled. */
    days: number;
}

/** A stored figure as the draw will use it: whole days, clamped rather than refused, on the settings rule. */
export function clampSkipLeanDays(value: unknown): number {
    const parsed = Math.floor(numberFrom(value, DEFAULT_SKIP_LEAN_DAYS));
    return Math.min(SKIP_LEAN_DAYS_RANGE.max, Math.max(SKIP_LEAN_DAYS_RANGE.min, parsed));
}

/** The lean as the operator has it set. Through `settingIsOn`, because a setting is a string. */
export function resolveSkipLean(config: AppConfig): SkipLean {
    return {
        enabled: settingIsOn(config, SKIP_LEAN_KEYS.enabled, DEFAULT_SKIP_LEAN),
        days: clampSkipLeanDays(config.get(SKIP_LEAN_KEYS.days, DEFAULT_SKIP_LEAN_DAYS)),
    };
}

/** How many days of skips to read: the window when on, `0` (no query) when off. */
export const skipDaysFor = (lean: SkipLean): number => (lean.enabled ? lean.days : 0);

/**
 * The multiplier for a record skipped `recovered` of the way through the window ago: {@link SKIP_FLOOR}
 * at `0` (just skipped), rising evenly to `1`. Absent, or anything that is not a number, weighs `1`.
 */
export const skipWeight = (recovered: number | undefined): number => {
    if (recovered === undefined || !Number.isFinite(recovered)) return 1;
    return SKIP_FLOOR + (1 - SKIP_FLOOR) * Math.min(1, Math.max(0, recovered));
};
