/**
 * Roughly when each queued item will reach the air, for the rules that only want to be roughly right.
 *
 * `air.clock.ts` answers the same question for anchored breaks and counts everything unmeasured as
 * zero, because a break that names a time must never land early. The SPACING rules want the opposite
 * from a guess: a run of records that each counted zero would look like no time passing at all, so
 * a break interval would never be reached and an artist queued an hour from now would read as on air
 * this minute. So here an unmeasured record counts as an average one. The two answers disagree on
 * purpose; see `air.clock.ts` for the other half of that argument.
 *
 * Pure: no config, no clock, no reads. A caller hands it the queue and, when it knows one, how long
 * is left of what is playing, and gets arithmetic back.
 */

import type { RundownTrack } from '#modules/playout/rundown.js';
import { isTrackItem, type StationLineupItem } from './station.lineup.js';

/**
 * How long an unmeasured record is assumed to run when spacing is being decided.
 *
 * Four and a half minutes, which is what this catalog actually averages. Nothing is measured off
 * the library at runtime: a constant that is close is worth more than a query on every boundary,
 * and every record the station owns carries a real duration anyway, so this is reached for only by
 * something newly discovered and not yet ingested.
 *
 * Moved here from `break.planner.ts`, which reached for it first, so that the break interval and the
 * artist cooldown count an unmeasured record as the same length rather than as two guesses.
 */
export const NOMINAL_TRACK_MS = 270_000;

/**
 * How much of the clock a record spends, for spacing.
 *
 * The trimmed length where the record was measured, because the dead air either side of its cue
 * points is time the station never spends; then the whole file; then {@link NOMINAL_TRACK_MS}.
 */
export function recordSpacingLength(track: Pick<RundownTrack, 'durationMs' | 'cueInMs' | 'cueOutMs'>): number {
    const { durationMs, cueInMs, cueOutMs } = track;
    if (cueOutMs !== undefined) return Math.max(0, cueOutMs - (cueInMs ?? 0));

    return durationMs === undefined ? NOMINAL_TRACK_MS : Math.max(0, durationMs - (cueInMs ?? 0));
}

/**
 * How much of the clock an item spends, for spacing.
 *
 * A segment counts as nothing, which is the one thing this and `air.clock.ts` agree on: nothing has
 * ever measured one, and an ident is a few seconds against a quarter of an hour.
 */
export function spacingLengthOf(item: StationLineupItem): number {
    return isTrackItem(item) ? recordSpacingLength(item.track) : 0;
}

/**
 * When each item starts, in milliseconds from now, indexed against the array it was given.
 *
 * `items` is what is still to come, in the order it will air: `StationLineup.upcoming()`, or any
 * run of it. The first item starts once what is playing has finished, so `leadMs` is how long that
 * is; absent, it is taken as nothing, which is a station between records or one that has only just
 * gone on air.
 *
 * One more entry than `items` holds, at the end: where whatever is appended next would start. That
 * is the number a refill wants, since it is the start of the batch it is choosing.
 */
export function estimateStartOffsets(items: readonly StationLineupItem[], leadMs = 0): number[] {
    const offsets: number[] = [];
    let at = Math.max(0, leadMs);
    for (const item of items) {
        offsets.push(at);
        at += spacingLengthOf(item);
    }
    offsets.push(at);
    return offsets;
}

/**
 * How far from now a batch of `count` records appended after `ahead` will MOSTLY be airing: where it
 * starts plus half its length, each record counted at {@link NOMINAL_TRACK_MS} since none is chosen yet.
 *
 * What a refill reads to decide which of a slot's mood stages it is choosing for (`mood.stage.ts`).
 * The record on air now is not counted, for `artistsQueuedWithin`'s reason: it is at most one record,
 * and a stage lasts a good part of an hour.
 */
export function batchMidpointMs(ahead: readonly StationLineupItem[], count: number): number {
    return estimateStartOffsets(ahead).at(-1)! + (Math.max(0, count) * NOMINAL_TRACK_MS) / 2;
}
