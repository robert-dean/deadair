/**
 * Where to cut a record so it ends by an instant, worked out at the moment it is handed to the player.
 *
 * The director knows WHAT has to happen: a hard marker airs at nine, so the record in front of it has to
 * be over by nine (`RundownItem.endBy`). Only the transport knows WHEN that record will start, because it
 * is the one holding the reading of what is on air, and with a player lead of one (`PLAYOUT_LEAD`) the
 * record is handed over while exactly one item, the one before it, is airing. So its start is that item's
 * observed start, plus how long that item plays, less the blend the two overlap by: three numbers this
 * class already has, and none of them a projection.
 *
 * The cut is placed {@link END_BY_GUARD_MS} LATE rather than exactly on the instant, because every error
 * here has a direction and the guard picks it: an observed start is noticed a moment after it happened,
 * and a marker a fraction of a second after its time is a marker on time, where one a fraction before is
 * a marker that is early. Nothing here can make a record LONGER: one that ends before the instant anyway
 * is left alone, and what fills the gap is not this file's business.
 */

import { cutOf, playedCues } from './annotate.js';
import { CUT_FADE_MS, type NowPlaying, type RundownItem } from './rundown.js';

/** How far past its instant a cut is placed, so the marker behind it is never early. */
export const END_BY_GUARD_MS = 500;

/**
 * When the item handed over now will start: just after the one on air ends, or now when nothing is.
 *
 * `undefined` when the item on air has no length anybody knows, which is an unmeasured record with no
 * duration or a break whose audio was never measured. Then there is nothing to cut against, and the
 * record plays to its end.
 */
export function nextStartsAt(onAir: NowPlaying | undefined, blendIntoMs: number, now: number): number | undefined {
    if (onAir === undefined) return now;
    const cues = playedCues(onAir.item);
    const length = cues === undefined ? onAir.item.durationMs : cues.cueOutMs - cues.cueInMs;
    if (length === undefined || !Number.isFinite(length) || length <= 0) return undefined;
    // Never in the past: an item on air longer than its length says (a reading that came late) is
    // ending now, not a moment ago.
    return Math.max(now, onAir.startedAt + length - Math.max(0, blendIntoMs));
}

/**
 * The record as it should be handed over: cut so it ends by {@link RundownItem.endBy}, or unchanged.
 *
 * Unchanged when it carries no `endBy`, when its start cannot be known, or when it would end before the
 * instant anyway. The cut is a position in the FILE, so it is measured from where the player starts
 * reading (`cueInMs`, or the top of an unmeasured file), and `cutOf` decides whether what comes out is a
 * cut at all.
 */
export function cutToEndBy(item: RundownItem, onAir: NowPlaying | undefined, blendIntoMs: number, now: number): RundownItem {
    if (item.endBy === undefined || !Number.isFinite(item.endBy)) return item;
    const startsAt = nextStartsAt(onAir, blendIntoMs, now);
    if (startsAt === undefined) return item;

    const cueIn = item.cueInMs !== undefined && Number.isFinite(item.cueInMs) && item.cueInMs > 0 ? item.cueInMs : 0;
    const cutAtMs = cueIn + (item.endBy - startsAt) + END_BY_GUARD_MS;
    // Less of the record than its own fade is not a record any more, it is a sting: it plays to its end
    // and the marker behind it is late, which is what a soft marker would have been anyway.
    if (cutAtMs - cueIn < CUT_FADE_MS) return item;
    const cut = { ...item, cutAtMs };
    return cutOf(cut) === undefined ? item : cut;
}
