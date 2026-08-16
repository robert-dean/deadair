/**
 * Who a caller is, when two of them want the same one-slot resource.
 *
 * The station runs one model and one speech engine, and `LlmGate` and `SpeechGate` each serialize
 * one of them. Both queued in arrival order alone, which is the right answer while every caller is
 * the station itself and the wrong one the moment an operator can start work from the console: a
 * preview that arrived first held the model, and a break writer behind it gave up after ten seconds
 * and fell to its deterministic floor. That is a console making the station worse by being looked
 * at.
 *
 * ## Two tiers, and deliberately not more
 *
 * Ordering the queue by ARRIVAL is a policy, and replacing it with a policy that has more than two
 * values means answering a starvation question. Two values does not:
 *
 * - Everything the station does for itself is {@link station}, and station callers are ordered
 *   against each other exactly as they were before this existed, which is to say by arrival. A
 *   refill and a break writer contend on the same terms they always have, and nothing about the
 *   tuning in `ModelSetGenerator.BUDGET_MS` or `ModelTalkBreakWriter`'s `maxWaitMs` changes meaning.
 * - Everything an operator started for themselves is {@link preview}, and always loses.
 *
 * So there is nothing to starve. A preview waiting behind the station is a preview whose operator is
 * watching a console that can tell them why, and previews cannot starve each other because they are
 * still first-come among themselves. **Ranking a break above a refill is the change that would need
 * an aging rule**, and it is not made here: the asymmetry between those two is already expressed by
 * bounding the background one, which is `LlmGate`'s own argument and still holds.
 *
 * `station` is the DEFAULT everywhere, so a caller that says nothing keeps the behaviour it had.
 * Only the two console previews name themselves, which is the right way round: the station's own
 * work should not have to remember to claim priority over a preview that does not exist yet.
 */
export type GatePriority =
    /** The station's own work: a break to write, a set to generate, a segment to speak. */
    | 'station'
    /** Something an operator asked for from the console, and is sitting in front of. */
    | 'preview';

/** Ordering value: higher goes first. Only the comparison matters, never the number. */
export const priorityRank: Record<GatePriority, number> = {
    station: 1,
    preview: 0,
};

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
    // step for every station caller arriving behind other station callers.
    let index = queue.length;
    while (index > 0 && priorityRank[queue[index - 1]!.priority] < rank) index -= 1;

    return index;
}
