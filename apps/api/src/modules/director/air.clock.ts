/**
 * When each item of the running order will reach the air.
 *
 * The director has always known the ORDER of what it plays and never the clock it plays against.
 * Everything anchored to a time — an ident at the top of the hour, a bulletin at half past, and one
 * day a programme handing over at nine — needs the same answer first: which boundary of the order
 * falls at or after a given instant.
 *
 * ## Everything unknown counts as zero, deliberately
 *
 * A record whose length nobody recorded, a segment (no segment has ever been measured — the column
 * is documented display-only), the overlap a crossfade will eat: all zero. So the answer is a LOWER
 * BOUND on when a boundary airs, and a target resolved against it lands at or AFTER the time it was
 * asked for.
 *
 * That direction is the whole point. A break placed late says "just after nine" a minute or two
 * late, which is what the phrasing is vague enough to absorb. A break placed EARLY says it before
 * nine, which is a lie the words cannot be vague enough to cover. Given the choice between the two
 * failures the projection always takes the first.
 *
 * It is also why {@link projectAirTimes} is not what the SPACING rules count with. "Roughly every
 * fifteen minutes" would rather be roughly right than certainly late, so an unmeasured record there
 * counts as an average one; see `break.planner.ts`. The two rules have opposite preferences and the
 * inconsistency is the point rather than an oversight.
 *
 * ## Pure, and only as long as it needs to be
 *
 * No config, no clock of its own, no reads. It is handed the order and an anchor and it does
 * arithmetic, which is what lets the interesting cases be tested without a running station. The
 * caller projects only the window it can plant into rather than the whole tail: over four to eight
 * items the unmeasured seconds are a rounding error, and over an hour of them they would not be.
 */

import { isTrackItem, type StationLineupItem } from './station.lineup.js';

/**
 * When each item airs, as epoch millis, indexed against the array it was given.
 *
 * `from` is the first item the projection covers and `anchorAt` is when that item starts. Entries
 * before `from` are `undefined`: they have aired or are airing, and a projection of the past is a
 * worse answer than no answer.
 *
 * The value at an index is when that item STARTS, which makes it also the boundary in front of it —
 * the gap a break would be planted into. That is the number every caller here actually wants.
 */
export function projectAirTimes(items: readonly StationLineupItem[], anchorAt: number, from: number): (number | undefined)[] {
    const times: (number | undefined)[] = new Array<number | undefined>(items.length).fill(undefined);

    let at = anchorAt;
    for (let index = Math.max(0, from); index < items.length; index++) {
        times[index] = at;
        at += lengthOf(items[index]!);
    }

    return times;
}

/**
 * The first boundary at or after an instant, or `undefined` when the order does not reach it.
 *
 * Answering `undefined` for a target past the end is the ordinary case rather than a failure: an
 * order holds twenty minutes of programme and the target is an hour out, so nothing is planted and
 * the next pass asks again against an order that has since been topped up. Every caller has to
 * treat it that way, because a caller that reached for the last boundary instead would put a
 * top-of-hour break wherever the order happened to stop.
 *
 * Separate from anything that places a segment, and exported on its own, because this is the
 * question a scheduled programme asks too: a show handing over at nine wants the first boundary at
 * or after nine, which is this function and not a second idea of the clock.
 */
export function nextBoundaryAtOrAfter(projected: readonly (number | undefined)[], target: number, from: number): number | undefined {
    for (let index = Math.max(0, from); index < projected.length; index++) {
        const at = projected[index];
        if (at !== undefined && at >= target) return index;
    }
    return undefined;
}

/**
 * How long an item occupies the air.
 *
 * The trimmed length where the record was measured, because that is what actually plays: `cueInMs`
 * and `cueOutMs` are where the player is told to start and stop reading, so the dead air either
 * side of them is time the station never spends. Falls back to the whole file, then to zero.
 *
 * A crossfade shortens this — two records overlap by `min(outgoing.outro, incoming.intro)` — and
 * that overlap is deliberately NOT subtracted. It would need both items' measurements and the
 * station's blend rules to compute, it is a few seconds against a four-minute record, and getting
 * it wrong in the cheap direction (counting the pair as slightly longer than they are) is the
 * direction this whole file rounds in anyway.
 */
function lengthOf(item: StationLineupItem): number {
    // A segment, which nothing has ever measured. Zero rather than a guess: an ident is a few
    // seconds, and a guess would be the one number here that could push a boundary EARLY.
    if (!isTrackItem(item)) return 0;

    const { durationMs, cueInMs, cueOutMs } = item.track;
    if (cueOutMs !== undefined) return Math.max(0, cueOutMs - (cueInMs ?? 0));

    return Math.max(0, (durationMs ?? 0) - (cueInMs ?? 0));
}
