import { Injectable } from 'injectkit';

/**
 * How many track measurements are in flight across the whole process, held to `analysis.concurrency`.
 *
 * The hourly walk sizes its own workers by that setting, which was enough while the walk was the
 * only thing that measured a record. It is not the only one now: a record the cache-ahead step has
 * just fetched is measured by a job of its own, and that job runs beside the walk rather than inside
 * it. Without one count shared between them, a station set to one measurement at a time would hand
 * the analyzer two whenever a fetch landed during the walk, and the setting would say something the
 * station does not do.
 *
 * A singleton, because the services that take a slot are SCOPED (one per job run) and a count kept
 * on any of them would only ever count itself.
 *
 * The limit is passed to every {@link run} rather than read here, so an operator's change applies to
 * the next measurement with no restart and the setting keeps one reader, `AnalysisService.concurrency`.
 * A limit lowered while more than it are running drains rather than cancels: nothing in flight is
 * stopped, and nothing new starts until the count is under the new figure.
 */
@Injectable()
export class AnalysisSlots {
    private active = 0;
    private readonly waiting: Array<() => void> = [];

    /** How many measurements hold a slot right now. For tests and nothing else. */
    get inFlight(): number {
        return this.active;
    }

    /**
     * Run one measurement once fewer than `limit` are in flight.
     *
     * Waiters are admitted in the order they arrived, so the walk's workers cannot starve a job that
     * queued behind them. The slot is released whether the work resolves or throws.
     *
     * @param limit - The current `analysis.concurrency`. Anything below one is read as one, so a
     *                limit can never wedge the queue shut.
     */
    async run<T>(limit: number, work: () => Promise<T>): Promise<T> {
        const width = Math.max(1, Math.floor(limit));
        while (this.active >= width) {
            await new Promise<void>(resolve => this.waiting.push(resolve));
        }

        this.active += 1;
        try {
            return await work();
        } finally {
            this.active -= 1;
            // Wake one waiter, which re-checks against its own limit. Woken rather than handed the
            // slot, so a limit raised in the meantime admits it at once and one lowered holds it.
            this.waiting.shift()?.();
        }
    }
}
