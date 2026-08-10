/**
 * The one way in to the director: commands, handled one at a time, in order.
 *
 * ## Why a queue rather than method calls
 *
 * Everything that changes what the station is airing arrives from somewhere with
 * its own lifetime. A rundown event fires from the pusher's loop, an operator's
 * change from a request scope, a refill from a job scope, and each of them used
 * to call the director directly. The director's own work spans awaits — it reads
 * `station_air`, plants breaks, looks segments up — and the event loop is free at
 * every one of them, so a caller could and did land in the middle of a decision
 * and change the state it was about to be applied to.
 *
 * The tree's answer to that so far is a fencing token plus five flags, one per
 * way of being interrupted, each added after the interruption it guards against
 * had already shipped a bug. A serial queue answers the whole class instead: if
 * only one command runs at a time, there is no middle to land in.
 *
 * ## The rule that keeps this from becoming a bottleneck
 *
 * **Commands are short.** Anything slow — generating a set, reading a provider,
 * rendering, walking the catalog — happens BEFORE the command is posted, and the
 * command carries the result. A command that awaited a rate-limited provider
 * would hold the station's only decision-making path for as long as that took,
 * and a track boundary would wait behind it.
 *
 * That is not a new discipline. It is what `DirectorService.commit` already does
 * around its epoch check, where everything slow is gathered first and the
 * mutation is one uninterrupted stretch afterwards. This makes it the rule for
 * every writer rather than for one method.
 *
 * A handler that gathers stale material is fine and expected: it re-validates
 * against the state it finds, and the state it finds cannot change underneath it.
 */

/**
 * Something the director has been asked to do.
 *
 * Deliberately only the arms that have a caller. Arms are added by the phase that
 * migrates their writer, because a union describing commands nobody sends is a
 * description of an intention rather than of this program.
 */
export type DirectorCommand =
    /** Something changed what the player is holding; top the running order up. */
    | { kind: 'wake' }
    /** The station is going off air, from the transport or from a lineup that ended. */
    | { kind: 'standDown' };

/** One posted command and the caller waiting on it. */
interface Envelope {
    command: DirectorCommand;
    resolve: () => void;
    reject: (error: unknown) => void;
}

export class DirectorMailbox {
    private readonly waiting: Envelope[] = [];
    private draining = false;

    /**
     * @param handle - What to do with a command. Called one at a time, never
     *   re-entered, and awaited to completion before the next command starts.
     */
    constructor(private readonly handle: (command: DirectorCommand) => Promise<void>) {}

    /**
     * Hand a command over, and find out how it went.
     *
     * The promise settles when THIS command has been handled, not when it was
     * accepted, which is what lets a request answer with the state its own change
     * produced rather than with a promise that it will happen shortly.
     *
     * Rejects with whatever the handler threw. A caller with nobody to tell —
     * a listener on the pusher's loop, say — must catch, or an unhandled rejection
     * takes the process down for a failure the next tick would have retried.
     */
    post(command: DirectorCommand): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.waiting.push({ command, resolve, reject });
            void this.drain();
        });
    }

    /** How many commands are waiting, for a test or a log line. Never for a decision. */
    depth(): number {
        return this.waiting.length;
    }

    /**
     * Work through the queue until it is empty.
     *
     * Re-entrant by design rather than by accident: a handler that posts is
     * appending to the array this loop is reading, so its command is picked up by
     * the same drain rather than starting a second one. That is what makes "the
     * director committed, which emitted a change, which woke the director" a queue
     * entry instead of a stack frame.
     *
     * One command's failure is its own. The loop keeps going, because the commands
     * behind it were sent by other callers about other things, and a station that
     * stopped taking decisions because one of them threw would be a worse failure
     * than the one that started it.
     */
    private async drain(): Promise<void> {
        if (this.draining) return;
        this.draining = true;

        try {
            while (this.waiting.length > 0) {
                const envelope = this.waiting.shift()!;
                try {
                    await this.handle(envelope.command);
                    envelope.resolve();
                } catch (error) {
                    envelope.reject(error);
                }
            }
        } finally {
            this.draining = false;
        }
    }
}
