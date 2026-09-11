import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { PluginError } from '@deadair/plugin-sdk';
import { insertionIndex, type GatePriority } from '#modules/shared/gate.priority.js';

/**
 * One synthesis at a time, and a way to give up waiting for it.
 *
 * ## Why serialize at all
 *
 * The same argument `LlmGate` is built on, applied to the other model the station runs. A
 * self-hosted Kokoro or Chatterbox is one process with one set of weights, usually on the same GPU
 * the words came from. Two syntheses at once do not go twice as fast; they interleave and both
 * finish later than either would have alone.
 *
 * It was serialized before this existed, but only by ACCIDENT: pg-boss puts one worker on the
 * `render.segment` queue, so two renders never overlapped. Nothing said so, nothing tested it, and
 * it stopped being true the moment a second producer existed — which `GET /voices/{id}/sample`
 * already is. An operator clicking through voices while the station renders a break was two callers
 * on one engine, with the station's own work slowed by a preview and no way to see it happening.
 *
 * ## What it does NOT need, and why
 *
 * There is no `budgetMs` here and no stream to release, both of which `LlmGate` needs and neither of
 * which applies:
 *
 * - **The slot is held for the whole call**, because `SpeechService` drains the audio into the
 *   content-addressed store before it returns. A model generation resolves as soon as the request
 *   is away and the words arrive over the following seconds, which is why that gate has to hold
 *   past its own `work` and release on the stream instead. This one does not: when the call
 *   returns, the engine is genuinely finished.
 * - **Both halves are already bounded.** `SPEAK_TIMEOUT_MS` bounds getting the handle, and the
 *   host's own per-body idle, lifetime and byte caps bound reading it. A timer here could not
 *   improve on that, because there is nothing for it to abort: `writeStream` takes no signal. If
 *   that bound ever proves too loose, the fix is to thread a signal through to the store, not to
 *   start a timer that can only watch.
 *
 * ## What giving up means
 *
 * {@link SpeechGateOptions.maxWaitMs} bounds the QUEUE and nothing else, which is the honest
 * failure: nothing has been spent and the caller can answer now rather than in two minutes. A
 * render job passes none, because nobody is waiting on it and the station skips a segment that is
 * not ready rather than holding its slot open. A voice preview passes a short one, because there is
 * an operator on the other end of it.
 *
 * This is also the natural home for the readiness question in
 * [render-plugin-readiness](https://github.com/robert-dean/deadair/discussions/29) piece 3, which wanted "a readiness gate the render job
 * consults" and worried that a wrong one fails closed on a station with no TTS plugin at all. It is
 * not built here: pieces 1 and 2 of that file make the race survivable, which is worth more than
 * making it rarer.
 */

/** How one caller wants to be treated by the queue. */
export interface SpeechGateOptions {
    /**
     * How long to wait for the engine before giving up. Absent means wait indefinitely.
     *
     * Absent is right for anything nobody is waiting on, which is every render the station plans
     * for itself.
     */
    maxWaitMs?: number;

    /** What is being spoken, for the log. */
    label?: string;

    /**
     * Who is asking. Absent means {@link GatePriority} `air`, which is every on-air render.
     *
     * Unlike the model's gate, nothing here is ever PREEMPTED once it holds the engine, only
     * ordered behind work with a deadline. That is not an oversight and not worth fixing: a
     * synthesis is one short line, so the longest the station can be kept waiting by one is a single
     * pass of it, and there is nothing to abort anyway — `writeStream` takes no signal. The model's
     * gate is the opposite case on both counts, which is why it does preempt.
     */
    priority?: GatePriority;

    /**
     * Give up waiting when this aborts, for a caller whose work has stopped being wanted.
     *
     * The same withdrawal `LlmGate` takes and for the same reason: a beat of a cancelled production
     * queued for the engine should leave the queue rather than be admitted, synthesized and thrown
     * away while a break that is still wanted waits behind it. Only the QUEUE is withdrawn from —
     * there is nothing to abort once the engine has started.
     */
    signal?: AbortSignal;
}

/** A caller waiting for the one engine. */
interface Waiter {
    admit: () => void;
    reject: (error: unknown) => void;
    priority: GatePriority;
    /** Cleared on admission, so a caller that got in is never also timed out. */
    timer?: NodeJS.Timeout;
    /** Stop listening for the caller's withdrawal. Run on admission and on every rejection. */
    unwatch?: () => void;
}

@Injectable()
export class SpeechGate {
    /** Whether the engine is busy. One slot, deliberately. See the class comment. */
    private busy = false;

    /** In priority order, then arrival: see `gate.priority.ts`. */
    private readonly waiting: Waiter[] = [];

    constructor(private readonly logger: Logger) {}

    /** How many callers are queued behind the one speaking, for a console and for the log. */
    depth(): number {
        return this.waiting.length;
    }

    /** Whether a synthesis is in flight. */
    speaking(): boolean {
        return this.busy;
    }

    /**
     * Hold the engine for one piece of work.
     *
     * The slot comes back when `work` resolves or throws, which is the whole contract: unlike a
     * generation, a synthesis is finished when the call that made it is.
     *
     * @throws {PluginError} `timeout` when {@link SpeechGateOptions.maxWaitMs} passed before the
     * engine came free, and whatever `work` threw otherwise.
     */
    async hold<TResult>(work: () => Promise<TResult>, options: SpeechGateOptions = {}): Promise<TResult> {
        await this.acquire(options);

        try {
            return await work();
        } finally {
            this.releaseSlot();
        }
    }

    /** Wait for the one slot: priority first, then arrival. */
    private async acquire(options: SpeechGateOptions): Promise<void> {
        // Checked before the free-slot fast path as well as inside the queue: a caller whose work
        // stopped being wanted before it ever asked should not be admitted just because the engine
        // happened to be idle.
        if (options.signal?.aborted === true) throw withdrawn(options.signal);

        if (!this.busy) {
            this.busy = true;
            return;
        }

        const priority = options.priority ?? 'air';
        this.logger.debug('render: waiting for the speech engine', { label: options.label, priority, ahead: this.waiting.length });

        await new Promise<void>((resolve, reject) => {
            const waiter: Waiter = {
                admit: () => {
                    if (waiter.timer) clearTimeout(waiter.timer);
                    waiter.unwatch?.();
                    resolve();
                },
                reject,
                priority,
            };

            /** Leave the queue and answer, for the two reasons a waiter ever gives up. */
            const giveUp = (error: PluginError) => {
                const index = this.waiting.indexOf(waiter);
                if (index >= 0) this.waiting.splice(index, 1);
                if (waiter.timer) clearTimeout(waiter.timer);
                waiter.unwatch?.();
                reject(error);
            };

            if (options.maxWaitMs !== undefined) {
                waiter.timer = setTimeout(() => {
                    giveUp(
                        new PluginError(`waited ${options.maxWaitMs}ms for the speech engine and it is still busy`)
                            .withCode('timeout')
                            .withRetry(options.maxWaitMs!),
                    );
                }, options.maxWaitMs);
                // Not a reason to hold the process open at shutdown.
                waiter.timer.unref?.();
            }

            if (options.signal !== undefined) {
                const signal = options.signal;
                const onAbort = () => giveUp(withdrawn(signal));
                signal.addEventListener('abort', onAbort, { once: true });
                // Removed on every exit, admission included: a waiter that got in and left a
                // listener behind keeps this closure — and the queue it closes over — alive for as
                // long as the caller's signal lives.
                waiter.unwatch = () => signal.removeEventListener('abort', onAbort);
            }

            // By priority, then arrival. A station caller goes in front of every waiting preview
            // and behind every waiting station caller, so the tier below never delays the station
            // and the tier itself is still first-come.
            this.waiting.splice(insertionIndex(this.waiting, priority), 0, waiter);
        });

        // Admitted by whoever released, which handed the slot over rather than clearing it.
        this.busy = true;
    }

    /**
     * Hand the slot to the next caller, or leave it free.
     *
     * Handed OVER rather than cleared and re-contended for, exactly as `LlmGate` does it: clearing
     * would let a caller that arrived while this ran jump the queue, which is not obviously wrong
     * until a busy station starves its own oldest request. The queue is already in the right order,
     * so the next caller is simply the front of it.
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

/**
 * What a caller that left the queue is told.
 *
 * `unavailable` rather than `timeout`: nothing ran out of time, the work stopped being wanted. No
 * retry hint, because asking again later is exactly what a withdrawn caller must not do. The
 * signal's own reason is preferred when it is one of ours, so a cancelled production says it was
 * cancelled rather than inheriting a sentence about a queue.
 */
function withdrawn(signal: AbortSignal): PluginError {
    return signal.reason instanceof PluginError
        ? signal.reason
        : new PluginError('this was no longer wanted before the speech engine came free').withCode('unavailable');
}
