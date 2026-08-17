import { Injectable } from 'injectkit';

/**
 * Whether a break took the model off this refill before it had programmed anything.
 *
 * ## Why this is a object and not a return value
 *
 * `SetGenerator.generate` answers with picks, and every generator in the chain answers the same
 * shape — which is the property that lets `SetGeneratorChain` top one up from the next without
 * knowing what any of them are. Widening that return type so ONE binding can report one more fact
 * would put a field on three generators that can never set it, for a reader none of them has.
 * `set.generator.chain.ts` already rejected the same move for attribution.
 *
 * So the fact travels beside the picks rather than inside them. Scoped, like every generator and
 * both jobs, so "the refill running in this scope was preempted" cannot be read by a different one:
 * the director opens a scope per unit of work and the job runner gives each execution its own.
 *
 * ## Why it is read-and-clear
 *
 * {@link took} answers once. A refill that is retried plans twice in the same scope, and a flag
 * that stayed set would make the second attempt look preempted whatever happened to it — which is
 * the difference between one retry and a loop. Clearing on read makes the caller's `while` correct
 * without the caller having to remember to reset anything.
 */
@Injectable()
export class RefillPreemption {
    private preempted = false;

    /**
     * Say that a break took the model back mid-conversation.
     *
     * Called by `ModelSetGenerator` off `LlmConversation.preempted`, which is set only where the
     * loop abandoned a step that had ALREADY asked for tools. A model that simply had nothing to
     * say does not come through here, and must not: this is the one signal that distinguishes work
     * the station interrupted from work the model declined to do, and a retry is only owed to the
     * first.
     */
    mark(): void {
        this.preempted = true;
    }

    /** Whether a preemption happened since this was last asked, clearing it as it answers. */
    took(): boolean {
        const was = this.preempted;
        this.preempted = false;
        return was;
    }
}
