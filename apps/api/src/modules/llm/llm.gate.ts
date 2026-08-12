import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { PluginError } from '@deadair/plugin-sdk';

/**
 * One generation at a time, and a budget that starts when it really starts.
 *
 * ## Why serialize at all
 *
 * The model this station is pointed at is one process with one set of weights in one GPU's memory.
 * Two generations at once do not go twice as fast; they interleave, evict each other's KV cache and
 * both finish later than either would have alone. A station that asks for a back-announce while a
 * show is being written wants the back-announce to wait, not to make the show slow.
 *
 * That reasoning is about a local model, and a hosted provider would happily take both. The gate is
 * still right for now, and the reason is worth writing down rather than rediscovering: the station
 * has one queue of things to say and they are wanted in order.
 *
 * ## Two callers now want it at once, and it is still one slot
 *
 * This used to say "widening this to a pool is a change to make when something genuinely needs two
 * at once, not before". Something does: `ModelSetGenerator` holds the model for minutes programming
 * a running order while `ModelTalkBreakWriter` wants it for seconds. That is not the argument for a
 * pool it looks like, so the finding is recorded here rather than left as an invitation.
 *
 * Widening is genuinely small — `busy` becomes a counter, {@link acquire} admits while under the
 * limit, and the waiter queue and all three release paths already work for N. It is still wrong,
 * for two reasons that both point the same way:
 *
 * - **The server serializes anyway.** One process, one set of weights, one GPU. A second app-side
 *   slot does not create a second worker; it relocates the queue to the model host, where there is
 *   no {@link LlmGateOptions.maxWaitMs}. And that timeout is the entire mechanism by which a break
 *   writer gives up and lets the deterministic floor write. Widening the gate would remove the
 *   thing that keeps a slow model from costing a silent station, while looking like it was helping.
 * - **Two concurrent generations are slower than two sequential ones**, which is the paragraph
 *   above and is not theoretical on a host whose context already spills VRAM.
 *
 * The real asymmetry between those two callers is PRIORITY, not throughput: one is a background job
 * nobody waits on and the other has a deadline. That is expressed by bounding the background one —
 * see `ModelSetGenerator`'s `BUDGET_MS` — and it needs nothing from this class.
 *
 * ## Fix one: the slot is held until the words STOP
 *
 * A generation is not over when `generate` resolves. It resolves as soon as the request is away and
 * the answer arrives afterwards, over seconds. Releasing the slot there would let the next
 * generation start against a model still producing the previous one, which is exactly the overlap
 * this exists to prevent, and it would look like the gate working.
 *
 * So {@link run} takes work that produces a stream and does not release until that stream ends,
 * errors or is cancelled. This was paid for in the previous station: with `stream: true`, releasing
 * on the resolved call let two generations overlap and nothing about the gate looked wrong.
 *
 * ## Fix two: the budget starts at ADMISSION
 *
 * A budget measured from when a caller joined the queue counts the wait against the work. The
 * failure that produces is specific and nasty: a long run's own calls starve each other, so the
 * busiest moments are exactly the ones where every generation aborts into its fallback, and the
 * station gets worse precisely when it has the most to say. The clock starts when the slot is
 * acquired.
 *
 * A caller that waited too long to be worth starting is a different question, answered by
 * {@link LlmGateOptions.maxWaitMs}: giving up in the queue is honest, and it happens before any
 * money or GPU time is spent.
 */

/** How one caller wants to be treated by the queue. */
export interface LlmGateOptions {
    /**
     * How long the whole generation gets, once admitted: starting it AND reading it to the end.
     *
     * Covering the drain is the point, because nothing else does. The invoker's deadline stops at
     * the handle, exactly as it does for speech, because a long answer legitimately outlives the
     * call that asked for it. But this gate holds the station's only model slot for as long as the
     * words keep arriving, so a stream that never ends would take the station's ability to say
     * anything with it — permanently, silently, and looking like a hung model rather than a bug.
     *
     * Absent means no bound, which is only right for a caller that has one of its own.
     */
    budgetMs?: number;

    /**
     * How long to wait for the slot before giving up. Absent means wait indefinitely.
     *
     * Separate from {@link budgetMs} on purpose, and the separation is the whole of fix two: this
     * bounds the queue, that bounds the work, and adding them together is what made a busy station
     * abort everything.
     */
    maxWaitMs?: number;

    /** What is being generated, for the log. */
    label?: string;
}

/** What the gated work hands back: something to read, and the answer once it has been read. */
export interface GatedGeneration<TResult> {
    stream: ReadableStream<string>;
    result: Promise<TResult>;
}

/** A caller waiting for the one slot. */
interface Waiter {
    admit: () => void;
    reject: (error: unknown) => void;
    /** Cleared on admission, so a caller that got in is never also timed out. */
    timer?: NodeJS.Timeout;
}

@Injectable()
export class LlmGate {
    /** Whether the model is busy. One slot, deliberately. See the class comment. */
    private busy = false;

    /** In arrival order, so a caller that waited longest goes next. */
    private readonly waiting: Waiter[] = [];

    constructor(private readonly logger: Logger) {}

    /** How many callers are queued behind the one generating, for a console and for the log. */
    depth(): number {
        return this.waiting.length;
    }

    /** Whether a generation is in flight. */
    generating(): boolean {
        return this.busy;
    }

    /**
     * Hold the model for a whole piece of work, however many generations it takes.
     *
     * What {@link run} is for one streaming generation, this is for a tool loop: several
     * generations with the station's own work between them, all of which must happen with the model
     * to themselves.
     *
     * **A tool loop is one admission, not one per round trip.** Releasing between steps would let
     * another generation interleave and evict the KV cache the loop's own next step is about to
     * want, and it would restart the budget clock in the middle of one answer. So the slot is held
     * from the first call to the last, which is also why the caller has to bound the number of
     * steps.
     *
     * `work` is handed the budget's signal and must not leave a stream running when it resolves:
     * the slot comes back the moment it does. That is the opposite of {@link run}'s contract and it
     * is safe here precisely because a loop reads each generation to the end before deciding
     * whether there is another.
     *
     * @throws whatever `work` throws, and `timeout` when {@link LlmGateOptions.maxWaitMs} passed
     * before a slot came free.
     */
    async hold<TResult>(work: (signal: AbortSignal) => Promise<TResult>, options: LlmGateOptions = {}): Promise<TResult> {
        await this.acquire(options);
        const budget = options.budgetMs === undefined ? undefined : startBudget(options.budgetMs);

        try {
            return await work(budget?.signal ?? neverAborts());
        } finally {
            budget?.dispose();
            this.releaseSlot();
        }
    }

    /**
     * Run one generation with the model to itself.
     *
     * `work` is given the signal to hand to the plugin and must return the stream and the result.
     * The slot is released when that stream ends, errors or is cancelled, NOT when `work` resolves,
     * which is the distinction the whole class exists for.
     *
     * @throws {PluginError} `timeout` when {@link LlmGateOptions.maxWaitMs} passed before a slot
     * came free, which is the honest failure: nothing was spent and the caller can fall back now
     * rather than in thirty seconds.
     */
    async run<TResult>(
        work: (signal: AbortSignal) => Promise<GatedGeneration<TResult>>,
        options: LlmGateOptions = {},
    ): Promise<GatedGeneration<TResult>> {
        await this.acquire(options);

        // Everything from here releases the slot exactly once, on whichever of the three paths
        // happens: `work` throwing, the stream ending, or the stream being cancelled.
        let released = false;
        const release = () => {
            if (released) return;
            released = true;
            budget?.dispose();
            this.releaseSlot();
        };

        // Started AFTER acquire and not before. This is fix two, and it is one line.
        const budget = options.budgetMs === undefined ? undefined : startBudget(options.budgetMs);

        let generation: GatedGeneration<TResult>;
        try {
            generation = await work(budget?.signal ?? neverAborts());
        } catch (error) {
            release();
            throw error;
        }

        return {
            stream: boundAndRelease(generation.stream, release, budget),
            // Deliberately NOT chained to the release. The result settles when the stream does, and
            // a caller that never reads the stream should not have the slot freed by awaiting this:
            // that would be the overlap bug wearing a different hat.
            result: generation.result,
        };
    }

    /** Wait for the one slot, in arrival order. */
    private async acquire(options: LlmGateOptions): Promise<void> {
        if (!this.busy) {
            this.busy = true;
            return;
        }

        const waited = this.waiting.length;
        this.logger.debug('llm: waiting for the model', { label: options.label, ahead: waited });

        await new Promise<void>((resolve, reject) => {
            const waiter: Waiter = {
                admit: () => {
                    if (waiter.timer) clearTimeout(waiter.timer);
                    resolve();
                },
                reject,
            };

            if (options.maxWaitMs !== undefined) {
                waiter.timer = setTimeout(() => {
                    const index = this.waiting.indexOf(waiter);
                    if (index >= 0) this.waiting.splice(index, 1);

                    reject(
                        new PluginError(`waited ${options.maxWaitMs}ms for the model and it is still busy`)
                            .withCode('timeout')
                            .withRetry(options.maxWaitMs!),
                    );
                }, options.maxWaitMs);
                // Not a reason to hold the process open at shutdown.
                waiter.timer.unref?.();
            }

            this.waiting.push(waiter);
        });

        // Admitted by whoever released, which handed the slot over rather than clearing it.
        this.busy = true;
    }

    /**
     * Hand the slot to the next caller, or leave it free.
     *
     * The slot is handed OVER rather than cleared and re-contended for. Clearing it would let a
     * caller that arrived while this ran jump the queue, which is not obviously wrong until a
     * station under load starves its own oldest request forever.
     */
    private releaseSlot(): void {
        const next = this.waiting.shift();
        if (next === undefined) {
            this.busy = false;
            return;
        }

        // Stays `true` across the handover: a gap here is a window for a new caller to take the
        // slot the queue was already owed.
        next.admit();
    }
}

/** The whole-generation budget: a signal for anything that watches one, and the error when it fires. */
interface Budget {
    signal: AbortSignal;
    /** The failure to end the stream with, once expired. */
    expiry: PluginError;
    expired: () => boolean;
    dispose: () => void;
}

/**
 * A budget that fires on its own, started by the act of calling this.
 *
 * The signal is for work that watches one; the stream bound below is for work that does not. Both,
 * because a plugin honouring cancellation is a courtesy and the slot has to come back either way.
 */
function startBudget(budgetMs: number): Budget {
    const controller = new AbortController();
    const expiry = new PluginError(`the model was still producing words after ${budgetMs}ms`).withCode('timeout');

    const timer = setTimeout(() => controller.abort(expiry), budgetMs);
    timer.unref?.();

    return {
        signal: controller.signal,
        expiry,
        expired: () => controller.signal.aborted,
        dispose: () => clearTimeout(timer),
    };
}

/** For a caller with no budget of the gate's own. A fresh controller nobody ever aborts. */
function neverAborts(): AbortSignal {
    return new AbortController().signal;
}

/**
 * The words, with the budget enforced and the slot released however they end.
 *
 * A hand-written wrapper rather than a `TransformStream`, and the reason is worth stating: a
 * transformer's `flush` covers a stream that finished and nothing covers one that errored in a way
 * TypeScript will admit exists. Reading the source explicitly puts all three endings in one place
 * where they can be seen to be exhaustive, which matters more here than brevity: a leaked slot stops
 * the station generating anything ever again, and presents as a hung model rather than as a bug.
 *
 * The budget is checked per chunk rather than by a timer reaching into the stream. A generation that
 * stops producing entirely is already caught by the invoker's deadline and the plugin's body caps;
 * what is left for this to catch is the one that never stops.
 */
function boundAndRelease(source: ReadableStream<string>, release: () => void, budget: Budget | undefined): ReadableStream<string> {
    const reader = source.getReader();

    /** Let the model go, whichever way this ended. Idempotent, so every path may call it. */
    const finish = async (): Promise<void> => {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
        release();
    };

    return new ReadableStream<string>({
        async pull(controller) {
            // Checked before the read as well as after, so a budget that expired while nothing was
            // arriving ends the generation on the next attention rather than on the next word.
            if (budget?.expired() === true) {
                await finish();
                controller.error(budget.expiry);
                return;
            }

            let chunk: ReadableStreamReadResult<string>;
            try {
                chunk = await reader.read();
            } catch (error) {
                // Ending two: the model, or the transport under it, failed mid-answer.
                await finish();
                controller.error(error);
                return;
            }

            if (chunk.done) {
                // Ending one: it said everything it had to say.
                await finish();
                controller.close();
                return;
            }

            controller.enqueue(chunk.value);
        },

        async cancel() {
            // Ending three: whoever was reading gave up. Their reason is their own; the slot comes
            // back either way.
            await finish();
        },
    });
}
