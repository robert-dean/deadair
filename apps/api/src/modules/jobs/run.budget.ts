/**
 * A wall-clock ceiling on one job run, on top of whatever the runner already
 * gave it.
 *
 * A walk that asks an upstream for every item has no bound of its own: the batch
 * size limits how many items it tries, not how long trying takes, and an upstream
 * that has slowed to a crawl turns a half-hourly pass into one that is still
 * going when the next is due. The budget is what makes the walk stop where it is
 * and leave the rest for the next run, which is always a legal place to stop
 * because each item settles on its own.
 *
 * Running out is NOT a failure. It is the signal that the upstream is the thing
 * setting the pace, which is why {@link withRunBudget} reports it rather than
 * throwing and every caller logs it beside the pass's own counts.
 *
 * ```ts
 * const { result, outOfTime } = await withRunBudget(RUN_BUDGET_MS, signal, stop => this.walk(limit, stop));
 * if (result.scanned > 0) this.logger.info('pass', { ...result, outOfTime });
 * ```
 *
 * @param budgetMs - How long the work may take before its signal is aborted.
 * @param signal - The runner's own signal, if it gave one. Combined with the
 *                 budget so either cancellation reaches the work.
 * @param work - Given the combined signal. Must forward it to be interruptible.
 */
export async function withRunBudget<T>(
    budgetMs: number,
    signal: AbortSignal | undefined,
    work: (stop: AbortSignal) => Promise<T>,
): Promise<{ result: T; outOfTime: boolean }> {
    // A plain controller on a plain timer rather than `AbortSignal.timeout`, for the reason
    // `plugin.invocation.deadline.ts` gives: that one's timer is unref'd and invisible to fake
    // timers, which would make the budget untestable.
    const budget = new AbortController();
    const timer = setTimeout(() => budget.abort(), budgetMs);
    const stop = signal ? AbortSignal.any([signal, budget.signal]) : budget.signal;

    try {
        // `result` is evaluated before `outOfTime`, which is what makes the flag report whether the
        // budget ran out DURING the work rather than before it started.
        return { result: await work(stop), outOfTime: budget.signal.aborted };
    } finally {
        clearTimeout(timer);
    }
}
