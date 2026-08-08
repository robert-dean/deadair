/**
 * A counter that says "the thing you started this against is no longer the thing
 * you are about to change".
 *
 * ## The problem it solves, which is not a locking problem
 *
 * The station is one process, and everything that drives it is a singleton with
 * an async method: read some state, `await` something slow, then mutate. Between
 * the read and the mutation the event loop is free, and the operator's Stop runs
 * there — synchronously, from an HTTP handler, on the same thread — clearing the
 * very state the suspended method is about to write to. It resumes on the far
 * side of a decision that has already been reversed and carries on as though
 * nothing happened.
 *
 * No database transaction helps with this. The contested state is an array in
 * memory, and ACID isolates transactions from each other rather than isolating a
 * function from itself across an `await`. A lock does not help either: a lock
 * held across the await would deadlock against the very handler that needs to
 * cancel the work, and one released before the mutation is no lock at all.
 *
 * This is a CANCELLATION problem. The state is correct at every instant; the
 * trouble is work begun under assumptions that stopped holding. The standard
 * answer is a fencing token, which is all this is.
 *
 * ## How to use it
 *
 * Take {@link current} before the first `await`, and check {@link isCurrent}
 * immediately before mutating anything, with no `await` between the check and the
 * mutation. Bump it from every place that invalidates work in flight.
 *
 * ```ts
 * const token = this.epoch.current();
 * const resolved = await somethingSlow();
 * if (!this.epoch.isCurrent(token)) return;  // nothing between here...
 * this.state.push(resolved);                 // ...and here
 * ```
 *
 * The value of one counter over a handful of booleans is that it covers reasons
 * to abandon that nobody has thought of yet. A flag answers "was it stopped?";
 * this answers "is anything different?", which is the question that actually
 * matters and the one that keeps being true after a new way to change the state
 * is added.
 */
export class Epoch {
    private value = 0;

    /** The token to carry across an await. */
    current(): number {
        return this.value;
    }

    /** Whether work started at `token` is still working against the same state. */
    isCurrent(token: number): boolean {
        return token === this.value;
    }

    /** Everything in flight is now stale. Called from wherever the state is replaced or dropped. */
    bump(): void {
        this.value += 1;
    }
}
