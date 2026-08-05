import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { annotateUri, ITEM_KEY } from './annotate.js';
import { PlayoutControlClient } from './liquidsoap.control.js';
import { Rundown } from './rundown.js';

/**
 * Drains the running order into Liquidsoap's request queue: the station's
 * transport.
 *
 * It RECONCILES rather than reacts. Every trigger takes a fresh reading of the
 * player and makes that the truth, instead of assuming what was pushed is still
 * there. That is what makes a Liquidsoap restart a non-event — the reading comes
 * back empty and the next pass re-pushes, with no app restart and no bookkeeping
 * to go stale — and it is why a dropped push is harmless.
 */

/**
 * How many items to keep queued BEYOND the one on air.
 *
 * One, because Liquidsoap resolves (and, for an http uri, downloads) the queued
 * item while the previous one plays. That is the lead the fetch needs, and it is
 * what keeps the boundary gapless. Zero would mean pushing at the boundary
 * itself, and any hesitation there drops the mount to the local bed for a moment.
 */
const LEAD = 1;

/** Safety net for anything that does not emit a change: a restart, a dropped push. */
const TICK_MS = 2000;

@Injectable()
export class PlayoutPusher {
    private timer?: NodeJS.Timeout;
    private readonly unsubscribes: (() => void)[] = [];
    /** One reconcile at a time: `next()` emits a change, which would otherwise re-enter here. */
    private busy = false;

    constructor(
        private readonly rundown: Rundown,
        private readonly control: PlayoutControlClient,
        private readonly logger: Logger,
    ) {}

    /** Begin draining the running order. Idempotent. */
    start(): void {
        if (this.timer) return;

        this.unsubscribes.push(this.rundown.onChange(() => this.tick()));
        // A reset is the station standing down or loading a different order, so what
        // was already handed over is no longer the running order: take back whatever
        // has not aired.
        this.unsubscribes.push(
            this.rundown.onReset(() => {
                void this.control.flush().catch(() => undefined);
            }),
        );

        this.timer = setInterval(() => this.tick(), TICK_MS);
        this.timer.unref?.();
        this.logger.info(`playout: pushing the rundown to liquidsoap (lead ${LEAD}, reconciling every ${TICK_MS}ms)`);
    }

    /** Stop draining. The player keeps playing whatever it already holds. */
    stop(): void {
        if (this.timer) clearInterval(this.timer);
        this.timer = undefined;
        for (const unsubscribe of this.unsubscribes.splice(0)) unsubscribe();
    }

    /**
     * Cut the item on air and let the queue advance — the operator skip. It lands
     * at once because the station owns the decoder: there is no external player
     * holding audio we would have to wait out.
     *
     * Tops the queue up FIRST. Skipping into an empty queue is legal but leaves
     * the playout source unavailable for a moment, and the mount audibly drops to
     * the local bed before the next push lands.
     *
     * @returns whether the stream took the command. A skip nobody heard should
     *   not be reported as one that happened.
     */
    async skipCurrent(): Promise<boolean> {
        await this.reconcile();
        const skipped = await this.control.skip();
        // The skip consumed the lead, so refill it now rather than waiting out the tick.
        if (skipped) this.tick();
        return skipped;
    }

    /**
     * Top the player's queue up to the lead. Safe to call at any time and from
     * any trigger: it no-ops unless the stream is reachable and the queue is
     * actually short.
     */
    async reconcile(): Promise<void> {
        if (this.busy) return;
        this.busy = true;

        try {
            const reading = await this.control.status();
            // Stream not up, or not yet reachable. Try again next tick.
            if (!reading) return;

            // Make the reading the truth BEFORE deciding what to hand over: it settles
            // what is on air, retires an item the player has stopped producing, and
            // takes back anything the player turns out not to be holding — so the
            // top-up below pushes against the player's real depth rather than our
            // memory of it.
            this.rundown.reconcile(reading);

            for (let queued = reading.queued; queued < LEAD; queued++) {
                const pulled = await this.rundown.next();
                // Nothing left: the player drains, the mount falls back to the local bed,
                // and loading a new order will wake us through onChange.
                if (!pulled) return;

                const landed = await this.control.push(annotateUri({ [ITEM_KEY]: pulled.item.id }, pulled.url));
                if (!landed) {
                    // Already popped, so put it back at the head rather than losing it:
                    // nothing aired, and the next pass should offer the same thing again.
                    this.rundown.unserve(pulled.item.id);
                    return;
                }
            }
        } finally {
            this.busy = false;
        }
    }

    /**
     * Fire a reconcile from a listener or the interval, swallowing anything it
     * throws. A failure here must never become an unhandled rejection: it runs
     * off a timer with nobody to await it, and the next pass is a tick away
     * regardless.
     */
    private tick(): void {
        // The busy flag is released by reconcile's own finally, so a throw cannot wedge it.
        this.reconcile().catch(error => this.logger.warn(`playout: reconcile failed (${error instanceof Error ? error.message : String(error)})`));
    }
}
