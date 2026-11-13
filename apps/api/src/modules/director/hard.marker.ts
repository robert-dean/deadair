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
 * When the order comes up EARLY instead, the marker is planted at the boundary BEFORE its time with a FILL
 * in front of it: a `bed` recording that runs to the time and is cut there (`StationLineupSegmentItem.fillTo`),
 * so the station waits rather than airing ahead of time. Where both are possible the planner takes whichever
 * moves the order less. When neither is, the marker lands as a soft one does and says so in the log.
 */

import type { AppConfig } from '@maroonedsoftware/appconfig';
import { numberInRange, type NumberRange } from '#modules/shared/setting.numbers.js';
import { isTrackItem, type StationLineupItem } from './station.lineup.js';

export const HARD_MARKER_KEYS = {
    maxCutSeconds: 'rotation.hardMarkerMaxCutSeconds',
    maxWaitSeconds: 'rotation.hardMarkerMaxWaitSeconds',
} as const;

/**
 * The kind of recording a wait is filled with: an instrumental bed, uploaded like any other recording. The
 * station plays it from its start until the marker's time, so its length is the longest wait it can fill.
 */
export const BED_KIND = 'bed';

/**
 * How much longer than the wait a bed has to be. The wait is measured against the projection, which is minutes
 * ahead of air and can be out by a blend, so a bed that only just covers it might run out a moment early.
 */
export const FILL_SLACK_MS = 30_000;

/**
 * Two minutes. A record is about four, so a cut of up to two lets a hard marker land on its time from about
 * half the boundaries it meets; past that the record is more cut than played and the marker lands soft.
 */
export const DEFAULT_HARD_MARKERS = { maxCutSeconds: 120, maxWaitSeconds: 60 } as const;

/** Five minutes is longer than most records, so it is the most a cut can ever be asked to take. */
export const HARD_MARKER_CUT_RANGE: NumberRange = { min: 0, max: 300 };

/** Five minutes of bed is a long time to wait on the radio, and the most a wait can be asked to fill. */
export const HARD_MARKER_WAIT_RANGE: NumberRange = { min: 0, max: 300 };

/**
 * The least of a record that is worth starting when it is going to be cut.
 *
 * Thirty seconds is about an intro and a first line. Less than that and a listener hears a record begin and
 * be faded away, which is worse than a marker a minute late.
 */
export const HARD_MIN_PLAY_MS = 30_000;

/** What the station allows a hard marker to do to the order around it. */
export interface HardMarkerRules {
    /** The most a record in the way may be cut short by. Zero is never. */
    maxCutMs: number;
    /** The longest the station may wait for a marker's time, filling it with a bed. Zero is never. */
    maxWaitMs: number;
}

/** The operator's limits, clamped to their range on the resolver rule in `apps/api/CLAUDE.md`. */
export function resolveHardMarkers(config: AppConfig): HardMarkerRules {
    const seconds = (key: string, fallback: number, range: NumberRange): number =>
        numberInRange(config.get(key, String(fallback)), fallback, range, Math.round);
    return {
        maxCutMs: seconds(HARD_MARKER_KEYS.maxCutSeconds, DEFAULT_HARD_MARKERS.maxCutSeconds, HARD_MARKER_CUT_RANGE) * 1000,
        maxWaitMs: seconds(HARD_MARKER_KEYS.maxWaitSeconds, DEFAULT_HARD_MARKERS.maxWaitSeconds, HARD_MARKER_WAIT_RANGE) * 1000,
    };
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

/**
 * How long the station would wait for a marker's time at the boundary BEFORE it, `at - 1`, or `undefined`
 * when it cannot.
 *
 * It can when that boundary is one the walk may still plant at (`nearest`), the order reaches it before the
 * time, the wait is no longer than the operator allows, and the station holds a bed long enough to fill it
 * with {@link FILL_SLACK_MS} to spare. Whether a break already sits there is the walk's question, as it is
 * for every other slot.
 */
export function waitBefore(
    projected: readonly (number | undefined)[],
    at: number,
    target: number,
    nearest: number,
    rules: HardMarkerRules,
    longestBedMs: number,
): number | undefined {
    const before = at - 1;
    const reaches = projected[before];
    if (before < nearest || reaches === undefined || reaches >= target) return undefined;
    const wait = target - reaches;
    if (wait > rules.maxWaitMs || longestBedMs < wait + FILL_SLACK_MS) return undefined;
    return wait;
}
