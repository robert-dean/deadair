import type { Segment } from '#modules/render/segment.repository.js';

/**
 * Whether a break's words are still true of the running order and the clock.
 *
 * A break is written minutes before it airs, and what it SAYS is fixed at that moment: "coming up,
 * X" and "it's just after nine" are both statements baked into audio that cannot be re-cut. Two
 * things then read the same question at different moments and must not answer it differently.
 * `DirectorService.toPlayerItems` asks at hand-over, where a broken claim costs the break, and
 * `BreakPlanner.ripen` asks in the write-ahead window, where a broken claim is worth a rewrite
 * because there is still time for one.
 *
 * **They have to be one expression.** An audit stricter than the hand-over check throws away breaks
 * that would have aired perfectly well; one looser never fires for the case the hand-over is about
 * to drop, which is exactly the boundary of silence the rewrite exists to prevent. So the predicate
 * lives here, pure and with no DI, and both callers phrase their own sentence from the answer.
 */

/** Why a break's words are no longer true. The two dimensions a claim can be made in. */
export type BrokenClaim =
    /** It named the record that plays next, and something else does. */
    | { kind: 'item'; claimed: string; next?: string }
    /** It named a time, and that time has passed (or has not arrived). */
    | { kind: 'time'; from: number; until: number };

/** Everything about a segment this question needs. Narrow, so a test needs no whole row. */
type Claiming = Pick<Segment, 'claimsItemId' | 'claimsTime'>;

/**
 * What is wrong with this break's claims, or `undefined` while they hold.
 *
 * `nextTrackId` is the id of the running-order LINE that will actually play next, passed in rather
 * than derived here so this module stays free of the order: both callers read it from
 * `StationLineup.nextTrackAfter`, which passes over lines that are skipped or unavailable.
 *
 * A break claiming nothing — most of them — holds by definition, and answers so without either
 * caller having to check first.
 */
export function brokenClaim(segment: Claiming, nextTrackId: string | undefined, now: number): BrokenClaim | undefined {
    // The forward claim. Everything that can happen to a running order between the writing and the
    // slot makes it false: an operator moves the item, a request goes in, the resolver drops the
    // pick, the record is benched for having no audio. The station would then name a record that is
    // not the one playing, in a confident voice, which is the kind of error a listener remembers.
    const claimedItem = segment.claimsItemId;
    if (claimedItem !== undefined && nextTrackId !== claimedItem) {
        // `next` absent for a break at the end of an order that has since lost its tail: the promise
        // is equally unkeepable, and equally not worth airing.
        return { kind: 'item', claimed: claimedItem, ...(nextTrackId === undefined ? {} : { next: nextTrackId }) };
    }

    // The same argument in the other dimension. A break that named a time is overtaken by the clock
    // exactly as one naming the next record is overtaken by an edit. An operator shuffling the
    // order, a run of skipped items, a record that took longer to fetch than the projection assumed:
    // any of them can push a break past the window its phrasing is true in.
    //
    // The window comes from the phrasing rather than from a constant, so a break saying something
    // vague is allowed to drift further than one saying something precise. See `clock.words.ts`,
    // which answers with the words and their window together.
    const claimedTime = segment.claimsTime;
    if (claimedTime !== undefined && (now < claimedTime.from || now >= claimedTime.until)) {
        return { kind: 'time', from: claimedTime.from, until: claimedTime.until };
    }

    return undefined;
}
