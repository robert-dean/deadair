/**
 * Who a caller is, when two of them want the same one-slot resource.
 *
 * The station runs one model and one speech engine, and `LlmGate` and `SpeechGate` each serialize
 * one of them. Both queued in arrival order alone, which is the right answer while every caller is
 * the station itself and the wrong one the moment anything else can start work: a preview that
 * arrived first held the model, and a break writer behind it gave up after ten seconds and fell to
 * its deterministic floor.
 *
 * ## Four tiers, named on ONE axis
 *
 * Every value answers the same question — **what is waiting** — which is what keeps this from
 * reading as a second copy of `BreakUrgency`. See the note on that boundary below.
 *
 * This was two tiers, `station` and `preview`, and the file argued that two needed no starvation
 * rule while more would. That argument was right about the cost and wrong about the price of
 * avoiding it, and the measurement is what settled it: of 24 `failed` rows in `script_history` on
 * 2026-08-16, **17 were `waited 10000ms for the model and it is still busy`**. That is
 * `ModelTalkBreakWriter` losing the model to a `ModelSetGenerator` refill holding it for minutes,
 * and falling to its floor — the station sounding worse for two thirds of its failures, over a
 * distinction the queue could not express. So the tiers split, and each one answers starvation for
 * itself:
 *
 * - {@link breaking} — a break that exists because something HAPPENED. It cannot be self-selected;
 *   see {@link priorityForUrgency}.
 * - {@link air} — ordinary breaks and the renders behind them. Each holds for seconds, so nothing
 *   below is kept waiting long by any one of them.
 * - {@link background} — refills and production passes. Preempted rather than merely outranked, and
 *   bounded by its own budget, so it cannot hold the slot against work with a deadline.
 * - {@link preview} — an operator at the desk. Always loses, and there is somebody watching a
 *   console that can say why.
 *
 * ## Ranking is not the same as preempting, and they deliberately disagree once
 *
 * `LlmGate` both orders its queue by rank AND asks a lower-ranked holder to stop. The second is what
 * makes the first worth having, because a refill HOLDS the model for minutes and queue order alone
 * would still leave a ten-second writer to time out behind it.
 *
 * The exception is at the top. **{@link breaking} outranks {@link air} in the queue and does not
 * preempt it**, because aborting a half-written break destroys that work and frees the slot no
 * sooner: preemption only aborts the holder's signal, and the slot comes back when the holder's own
 * work returns. The interrupt would pay for the eviction and still wait exactly as long. Below that
 * line the trade is the other way round — a preempted refill falls to `CatalogSetGenerator` and the
 * chain tops up whatever is missing on the next pass, which is the same bargain a preempted break
 * already makes with `TalkBreakWriter`.
 *
 * ## This is NOT `BreakUrgency`, and the two must not be merged
 *
 * They answer different questions. An urgency says how soon a break must be HEARD, and carries lead
 * times, deadlines and expiry with it in `URGENCY`. A tier says who gets the one model slot. Merging
 * them would make two of the four values lie, because a refill and a preview have no urgency at all:
 * neither is going on air. {@link priorityForUrgency} is the ONE place the two vocabularies meet,
 * and anything that needs a third mapping should be suspected of wanting a fifth tier instead.
 *
 * {@link air} is the DEFAULT everywhere, so a caller that says nothing keeps a deadline. Only the
 * console previews and the two deadline-free producers name themselves, which is the right way
 * round: the station's own on-air work should not have to remember to claim priority.
 */
export type GatePriority =
    /** A break that exists because something happened: breaking news, a listener arriving. */
    | 'breaking'
    /** The station's ordinary on-air work: a break to write, a segment to speak. */
    | 'air'
    /** Work with no air deadline at all: a refill, a production being made hours ahead. */
    | 'background'
    /** Something an operator started for themselves, and is sitting in front of. */
    | 'preview';

/** Ordering value: higher goes first. Only the comparison matters, never the number. */
export const priorityRank: Record<GatePriority, number> = {
    breaking: 3,
    air: 2,
    background: 1,
    preview: 0,
};

/**
 * Whether an arriving caller should ask whoever holds the slot to stop.
 *
 * Outranking is necessary and not sufficient, which is the whole of why this is a function rather
 * than a `>` at each call site. {@link breaking} outranks {@link air} and must NOT evict it: the
 * eviction would throw away a nearly-written break and return the slot no sooner, because a holder
 * stops when its own work returns rather than when its signal aborts.
 *
 * So the line is drawn under {@link air}: anything with a deadline may take the slot back from
 * anything without one, and nothing preempts inside the two tiers that have one.
 */
export function shouldPreempt(arriving: GatePriority, holder: GatePriority): boolean {
    return priorityRank[arriving] >= priorityRank.air && priorityRank[holder] < priorityRank.air;
}

/**
 * Where a new waiter belongs in a queue already sorted by rank then arrival.
 *
 * Behind everyone at least as important as it, which keeps arrival order inside a tier and puts a
 * whole tier in front of the one below. Answers the queue's length for a caller nobody outranks,
 * which is the ordinary `push`.
 */
export function insertionIndex(queue: readonly { priority: GatePriority }[], priority: GatePriority): number {
    const rank = priorityRank[priority];

    // From the back, because the common case by far is a caller that belongs at the end: one scan
    // step for every caller arriving behind others of its own tier.
    let index = queue.length;
    while (index > 0 && priorityRank[queue[index - 1]!.priority] < rank) index -= 1;

    return index;
}
