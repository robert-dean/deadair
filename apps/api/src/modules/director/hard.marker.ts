/**
 * Hard markers: a clock band that airs at its time exactly, and never before it.
 *
 * A soft marker (every band before `clock_bands.hard`) takes the first boundary at or after its time, which
 * on the live station put the half-past news on air a median of four minutes late. A hard marker is planted
 * at that same boundary, and the record in front of it is CUT so it ends on the time: the planner decides
 * which record and roughly how much here, against the projection, and the pusher decides exactly how much
 * at hand-over, against what is actually on air (`playout/end.by.ts`). The fade the cut ends on is the
 * player's (`CUT_FADE_MS`).
 *
 * Only the late side lives here so far. When the record in front would be cut by more than an operator
 * allows, or would play too little before being cut to be worth starting, the marker lands as a soft one
 * does and says so in the log.
 */

import type { AppConfig } from '@maroonedsoftware/appconfig';
import { numberInRange, type NumberRange } from '#modules/shared/setting.numbers.js';
import { isTrackItem, type StationLineupItem } from './station.lineup.js';

export const HARD_MARKER_KEYS = {
    maxCutSeconds: 'rotation.hardMarkerMaxCutSeconds',
} as const;

/**
 * Two minutes. A record is about four, so a cut of up to two lets a hard marker land on its time from about
 * half the boundaries it meets; past that the record is more cut than played and the marker lands soft.
 */
export const DEFAULT_HARD_MARKERS = { maxCutSeconds: 120 } as const;

/** Five minutes is longer than most records, so it is the most a cut can ever be asked to take. */
export const HARD_MARKER_CUT_RANGE: NumberRange = { min: 0, max: 300 };

/**
 * The least of a record that is worth starting when it is going to be cut.
 *
 * Thirty seconds is about an intro and a first line. Less than that and a listener hears a record begin and
 * be faded away, which is worse than a marker a minute late.
 */
export const HARD_MIN_PLAY_MS = 30_000;

/** What the station allows a hard marker to do to the order around it. */
export interface HardMarkerRules {
    /** The most a record in the way may be cut short by. Zero is never: every hard marker lands soft. */
    maxCutMs: number;
}

/** The operator's limits, clamped to their range on the resolver rule in `apps/api/CLAUDE.md`. */
export function resolveHardMarkers(config: AppConfig): HardMarkerRules {
    const seconds = numberInRange(
        config.get(HARD_MARKER_KEYS.maxCutSeconds, String(DEFAULT_HARD_MARKERS.maxCutSeconds)),
        DEFAULT_HARD_MARKERS.maxCutSeconds,
        HARD_MARKER_CUT_RANGE,
        Math.round,
    );
    return { maxCutMs: seconds * 1000 };
}

/**
 * Whether a hard marker can land ON its time at boundary `at`, the first at or after it.
 *
 * It can when the item in front of that boundary is a record (speech is never cut), it starts before the
 * time, it will have played at least {@link HARD_MIN_PLAY_MS} by then, and cutting it to end on the time
 * takes no more than the operator allows. `false` is not a failure: the marker lands soft.
 *
 * `projected` is the order's projection (`projectAirTimes`), a lower bound on when each item starts, and
 * that is the safe direction here as it is everywhere else: a record projected to start earlier than it
 * will is cut by less than it needs, and the pusher, which reads what is actually on air, cuts it by the
 * rest.
 */
export function canLandOnTime(
    items: readonly StationLineupItem[],
    projected: readonly (number | undefined)[],
    at: number,
    target: number,
    rules: HardMarkerRules,
): boolean {
    const record = items[at - 1];
    const starts = projected[at - 1];
    const ends = projected[at];
    if (record === undefined || !isTrackItem(record) || starts === undefined || ends === undefined) return false;
    if (target - starts < HARD_MIN_PLAY_MS) return false;
    return ends - target <= rules.maxCutMs;
}
