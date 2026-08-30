import type { Segment } from '#modules/render/segment.repository.js';

/**
 * Whether a break's words are still true of the running order and the clock.
 *
 * A break is written minutes before it airs, and what it SAYS is fixed at that moment: "coming up,
 * X", "it's just after nine" and "it's seventeen and raining" are all statements baked into audio
 * that cannot be re-cut. Two things then read the same question at different moments and must not
 * answer it differently.
 * `DirectorService.toPlayerItems` asks at hand-over, where a broken claim costs the break, and
 * `BreakPlanner.ripen` asks in the write-ahead window, where a broken claim is worth a rewrite
 * because there is still time for one.
 *
 * **They have to be one expression.** An audit stricter than the hand-over check throws away breaks
 * that would have aired perfectly well; one looser never fires for the case the hand-over is about
 * to drop, which is exactly the boundary of silence the rewrite exists to prevent. So the predicate
 * lives here, pure and with no DI, and both callers phrase their own sentence from the answer.
 *
 * ## A time claim is broken in two directions, and only one of them is worth a rewrite
 *
 * `when` is what says which. At hand-over both are equally fatal — a break saying "just after half
 * past three" is wrong at twenty-five past and wrong again at twenty to, and airing either is the
 * station stating something false about the clock. In the write-ahead window they are opposites:
 * `late` means the slot has drifted past the phrasing and a rewrite fixes it — as long as something
 * moves `segments.airs_at` first, which is the subsection below — while `early` is the ORDINARY
 * state of every break written ahead of its own window and a rewrite cannot fix it at all. The
 * words come from `airs_at`, and re-projecting cannot make a break air sooner than the order says
 * it will, so the second attempt re-derives the same phrasing and re-stamps the same window, and
 * the pass after that finds it early again.
 *
 * That loop was live. `WRITE_AHEAD` is eight items and the phrasings in `clock.words.ts` are seven
 * minutes wide, so a bulletin planted on a clock band was stamped for a window half an hour out and
 * reported broken on every director pass until its slot arrived. Talk breaks absorbed it — a
 * rewrite costs a model call and the floor cannot fail — but a bulletin's rewrite is DESTRUCTIVE:
 * `ReadLog.keep` spends its headlines at selection, so three rewrites in twenty seconds emptied the
 * window and every write after that declined, failed the segment and passed over the slot. Measured
 * on air on 24 August: seven bulletins lost that way in two hours, in bursts of four.
 *
 * So the predicate stays one expression and reports the direction; `BreakPlanner.staleClaims` is
 * where the policy lives, because "is this worth reopening" is the caller's question and not this
 * one's. The price, taken deliberately, is that a break running EARLY is no longer rewritten and is
 * dropped at hand-over instead — one silent boundary, where the loop cost the next hour of news.
 *
 * ### And `late` was the same loop, which took another five weeks to notice
 *
 * "A rewrite fixes it" was true of the intent and false of the code, for exactly the reason the
 * paragraph above gives about `early`: the phrasing came from `segments.airs_at`, and nothing
 * revised that either. So an order running LATE past a break's window had every rewrite re-derive
 * the same words, re-stamp the same closed window, and be reopened on the next boundary — until the
 * slot arrived, the reopen landed in the same pass as the hand-over, and the break was dropped for
 * still being `planned`. Measured on the live station on 30 August: 234 reopens in seven days
 * against 94 for a record genuinely leaving the order, 64 breaks written three or more times, one
 * written twelve, and 76 passed over at their slot. Every attempt at one of them said "coming up to
 * quarter to one" about a moment already eight minutes gone.
 *
 * The half that was missing is now `BreakPlanner.reproject`, which moves `airs_at` to where the
 * order says the break lands before any of this is asked. `late` is therefore worth a rewrite again
 * — genuinely, rather than by assertion — because the second attempt is derived from a different
 * moment than the first. **Both halves have to hold**: if the projection ever stops being refreshed,
 * this is a loop again and the exclusion below is the only thing standing between the station and it.
 *
 * Why it surfaced when it did is worth keeping. Talk breaks had no `airs_at` at all until they were
 * given one, so the station's most common break made no time claim and could not loop; switching it
 * on turned a latent bug in the bulletin path into the ordinary case.
 *
 * ## The third dimension is what the break REPORTED, and it arrived late
 *
 * A break that said what it is like outside is a statement about the present with a shelf life, and
 * for a while nothing here knew that. Weather shipped as a capability after this file was written
 * and did not inherit it: the guards on that path make a figure unfabricable — `inventedFigure`
 * refuses any number the reading did not carry — and say nothing at all about whether it is STILL
 * TRUE, because they check the script against the reading it was written from. That is the one
 * comparison that cannot catch age.
 *
 * `claims_reading_until` is the answer, and it is deliberately shaped unlike the time claim beside
 * it. One end rather than two, and no direction, because an observation has no not-true-yet. Which
 * is also why it IS worth a rewrite where an early time claim is not: rewriting re-derives the same
 * phrasing from the same unchanged `airs_at`, and it fetches a genuinely new observation.
 */

/** Why a break's words are no longer true. The three dimensions a claim can be made in. */
export type BrokenClaim =
    /** It named the record that plays next, and something else does. */
    | { kind: 'item'; claimed: string; next?: string }
    /** It named a time, and the clock is outside the window that phrasing is true in. */
    | { kind: 'time'; from: number; until: number; when: TimeFault }
    /** It reported a measurement, and the observation behind it has aged out. */
    | { kind: 'reading'; until: number };

/**
 * Which side of its window a time claim fell off.
 *
 * `early` — the phrasing has not become true yet, which is what every break written ahead of its
 * slot looks like. `late` — the window has closed, which is drift.
 */
export type TimeFault = 'early' | 'late';

/** Everything about a segment this question needs. Narrow, so a test needs no whole row. */
type Claiming = Pick<Segment, 'claimsItemId' | 'claimsTime' | 'claimsReadingUntil'>;

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
    //
    // Which SIDE it fell off is reported rather than flattened, because the two sides mean opposite
    // things to the rewrite and the same thing to the hand-over. See the note above.
    const claimedTime = segment.claimsTime;
    if (claimedTime !== undefined && now < claimedTime.from) {
        return { kind: 'time', from: claimedTime.from, until: claimedTime.until, when: 'early' };
    }
    if (claimedTime !== undefined && now >= claimedTime.until) {
        return { kind: 'time', from: claimedTime.from, until: claimedTime.until, when: 'late' };
    }

    // The third dimension, and the one the station does not move. A break that REPORTED something —
    // what it is like outside — was true of a moment that has since passed, and nothing here or in
    // the running order did anything wrong: the world moved. See `segments.claims_reading_until`.
    //
    // No direction is reported, because there is only one. A reading has no not-true-yet: it was
    // measured, and then it ages. That is also what makes it worth a REWRITE where a time claim
    // running early is not — the rewrite fetches a new observation, so the second attempt is
    // genuinely different, and the loop the note above describes cannot form. See
    // `BreakPlanner.staleClaims`, which acts on this and refuses the other.
    const readingUntil = segment.claimsReadingUntil;
    if (readingUntil !== undefined && now >= readingUntil) {
        return { kind: 'reading', until: readingUntil };
    }

    return undefined;
}
