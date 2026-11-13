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
 * The least of a fill that is ever played: a tenth of a second, the player's own hard join. Not zero,
 * because a track the player is told to read nothing of is one it produces nothing for.
 */
export const FILL_LEAST_MS = 100;

/**
 * When the item handed over now will start: just after the one on air ends, or now when nothing is.
 *
 * Two readings of when the item on air ends, and the EARLIER is taken. Its observed start plus its length
 * is the steady one, but the start is when this process first SAW it on air: after a restart that is the
 * restart, minutes into the record, and the next item would be thought to start minutes later than it
 * will, cut minutes short, and the marker behind it would air early. The player's own `remainingMs` does
 * not have that problem and is jumpy instead. An earlier start can only make the next item play longer,
 * which puts any error on the late side, where this file wants it.
 *
 * `undefined` when neither says, which is an item on air with no length anybody knows and no reading of
 * what is left. Then there is nothing to cut against, and the record plays to its end.
 */
export function nextStartsAt(onAir: NowPlaying | undefined, blendIntoMs: number, now: number): number | undefined {
    if (onAir === undefined) return now;
    const cues = playedCues(onAir.item);
    const length = cues === undefined ? onAir.item.durationMs : cues.cueOutMs - cues.cueInMs;
    const byLength = length === undefined || !Number.isFinite(length) || length <= 0 ? undefined : onAir.startedAt + length;
    const byReading = onAir.remainingMs === undefined || !Number.isFinite(onAir.remainingMs) ? undefined : now + onAir.remainingMs;
    const ends = byLength === undefined ? byReading : byReading === undefined ? byLength : Math.min(byLength, byReading);
    if (ends === undefined) return undefined;
    // Never in the past: an item on air longer than its length says (a reading that came late) is
    // ending now, not a moment ago.
    return Math.max(now, ends - Math.max(0, blendIntoMs));
}

/**
 * How early the item after this one will air against the instant it was meant to wait for, or `undefined`
 * when it will not be early (or nothing can say).
 *
 * The planner sizes a cut or a wait against a projection minutes ahead of air, and the order can arrive
 * EARLIER than that said: a record taken out or skipped in front of the marker, a break dropped by its
 * claim check, a bed missing. A record that now ends before its instant, or a bed that runs out before it,
 * puts the marker behind it on air early, and nothing here can lengthen either. This says by how much, so
 * the pusher can say so where an operator will see it rather than the station quietly breaking the one
 * promise a hard marker makes.
 */
export function earlyByMs(item: RundownItem, startsAt: number | undefined): number | undefined {
    if (item.endBy === undefined || startsAt === undefined) return undefined;
    const cues = playedCues(item);
    const length = cues === undefined ? item.durationMs : cues.cueOutMs - cues.cueInMs;
    if (length === undefined || !Number.isFinite(length)) return undefined;
    const early = item.endBy - (startsAt + length);
    return early > END_BY_GUARD_MS ? early : undefined;
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
    // One that ends before its instant anyway is left alone: nothing here can make it longer, and
    // `earlyByMs` is how the pusher says so.

    const cueIn = item.cueInMs !== undefined && Number.isFinite(item.cueInMs) && item.cueInMs > 0 ? item.cueInMs : 0;
    const cutAtMs = cueIn + (item.endBy - startsAt) + END_BY_GUARD_MS;
    // A fill exists only to take up time, so it is cut however little is left, and to next to nothing
    // when the order has caught up: played whole it would put the marker behind it late.
    if (item.fill === true) {
        const fill = { ...item, cutAtMs: Math.max(cueIn + FILL_LEAST_MS, cutAtMs) };
        return cutOf(fill) === undefined ? item : fill;
    }
    // Less of the record than its own fade is not a record any more, it is a sting: it plays to its end
    // and the marker behind it is late, which is what a soft marker would have been anyway.
    if (cutAtMs - cueIn < CUT_FADE_MS) return item;
    const cut = { ...item, cutAtMs };
    return cutOf(cut) === undefined ? item : cut;
}
