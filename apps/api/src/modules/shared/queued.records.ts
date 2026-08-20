import { Injectable } from 'injectkit';

/**
 * What the running order already holds, for the refill that is extending it.
 *
 * ## Why this exists rather than a parameter
 *
 * The station knows which records are already queued. The MODEL was left to guess, and the guess is
 * not available to it: the prompt's avoid list is capped at `MAX_AVOID_SHOWN` and the rest travel as
 * "(and 39 more already queued, not listed)" — measured on one hour, and 43 and 55 on the two after
 * it. So a search would hand back a record the model could not use, with nothing on the row saying
 * so, and naming it cost a pick that `PickResolver` then discarded as a duplicate.
 *
 * Marking the row is the same move `owned` already makes, and it is preferred to a TOOL for asking
 * — a question the host can answer must not become a decision the model has to make, which is the
 * whole argument that collapsed two search tools into one. It also costs no step, and a step is the
 * scarce thing.
 *
 * The keys have to travel out of band because of who holds them. `SetInputs.avoidSongKeys` reaches
 * `ModelSetGenerator`, and the thing that needs them is `MusicSearchTool`, which is built by the
 * tool registry and knows nothing about any refill. `RefillPreemption` is the same shape in the
 * opposite direction and carries the same reasoning: scoped, so "the refill running in THIS scope"
 * cannot be read by another, since the director opens a scope per unit of work and the job runner
 * gives each execution its own.
 *
 * ## It holds opaque keys
 *
 * Deliberately, so this stays a container rather than a second opinion about what makes two records
 * the same. Both sides build their keys with `songKey`, which is the one place that rule lives and
 * is what `play_history` and the repeat window are written with — a holder that normalized names
 * for itself would be a third spelling nobody could see disagreeing with the other two.
 *
 * ## Empty is the ordinary state
 *
 * A break writer shares the search tool and is extending nothing, so nothing is remembered and no
 * row is marked. That is correct rather than a gap: from a break writer's side there is no running
 * order being filled, and a `queued` flag would be answering a question it did not ask.
 */
@Injectable()
export class QueuedRecords {
    private readonly keys = new Set<string>();

    /**
     * Take the refill's avoid set.
     *
     * Additive, because a scope may plan twice — the retry `RefillPreemption` exists to allow — and
     * the second attempt is extending everything the first one was, at least.
     */
    remember(keys: Iterable<string>): void {
        for (const key of keys) this.keys.add(key);
    }

    /** Whether this record is already in the order being extended. */
    has(key: string): boolean {
        return this.keys.has(key);
    }

    /** How many, for a caller deciding whether it is worth saying anything at all. */
    get size(): number {
        return this.keys.size;
    }
}
