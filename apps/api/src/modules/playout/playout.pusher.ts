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

/**
 * How long a skip waits for the player to actually cross the boundary, and how
 * often it looks.
 *
 * `playout_queue.skip()` takes effect in Liquidsoap's streaming loop rather than
 * in the request that asked for it, so the reading that comes back with the skip
 * can still name the item that was cut. Without this the operator's own response
 * describes the track they just removed, and the console shows it until the
 * `aired` notify or the next reconcile tick corrects it — which is most of the
 * "the skip took a second to happen" the console appears to have.
 *
 * A budget rather than a wait: the answer goes out either way, describing the
 * best reading available. It is only ever spent on a human pressing a button,
 * never on the reconcile loop.
 */
const SKIP_CONFIRM_BUDGET_MS = 1000;
const SKIP_CONFIRM_INTERVAL_MS = 100;

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
        //
        // Standing down goes further and hands the mount back, which ends the
        // broadcast at once rather than at the end of an item nobody asked for. A
        // REPLACEMENT does not: the station is still on air, and swapping the running
        // order is not a reason to cut the listener off mid-track.
        this.unsubscribes.push(
            this.rundown.onReset(standingDown => {
                const handed = standingDown ? this.control.releaseOnAir() : this.control.flush();
                void handed.catch(() => undefined);
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
     * Then waits, briefly, for the boundary it just asked for — see
     * {@link SKIP_CONFIRM_BUDGET_MS}. The caller is a request whose response is
     * built from the rundown, so returning before the player has crossed over
     * means answering with the track that was cut.
     *
     * @returns whether the stream took the command. A skip nobody heard should
     *   not be reported as one that happened.
     */
    async skipCurrent(): Promise<boolean> {
        await this.reconcile();

        const before = this.rundown.nowPlaying()?.item.id;
        const reading = await this.control.skip();
        if (!reading) return false;

        this.rundown.reconcile(reading);
        await this.confirmBoundary(before);

        // The skip consumed the lead, so refill it now rather than waiting out the tick.
        this.tick();
        return true;
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
            // Renewing the lease IS the reading: `radio.liq` answers /control/onair
            // with the same reading as /control/status, so holding the station on air
            // costs nothing beyond the poll this loop was already making.
            //
            // Asserted only while there is a programme. An app that is merely running
            // must not hold a mount it has nothing to put on — which is precisely the
            // state a restart leaves behind, with the rundown empty and Liquidsoap
            // still holding an item from a process that no longer exists.
            const reading = this.rundown.hasProgramme() ? await this.control.assertOnAir() : await this.control.status();
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
     * Re-read the player until something OTHER than `before` is on air, or the
     * budget runs out.
     *
     * "Nothing on air" is not the answer being waited for, even though it is a
     * change: the item behind the skip is resolving (for an http uri, still
     * downloading) and the mount has fallen to the local bed for a moment. Coming
     * back with that would report the station as idle a beat before it names the
     * track it actually started.
     *
     * Deliberately not part of {@link reconcile}: that runs on a timer every
     * couple of seconds and has to stay a single cheap pass. This is the operator
     * path only, and it is bounded so a player that never crosses the boundary —
     * a skip into an empty queue, a stream that went away mid-command — costs a
     * second and then answers with what it does know.
     *
     * Each reading is reconciled on the way past, so the wait is not idle: it is
     * the same pull the loop does, just sooner and more often.
     */
    private async confirmBoundary(before: string | undefined): Promise<void> {
        if (before === undefined) return;

        const deadline = Date.now() + SKIP_CONFIRM_BUDGET_MS;
        while (Date.now() < deadline) {
            await sleep(SKIP_CONFIRM_INTERVAL_MS);

            const reading = await this.control.status();
            // The stream went away. The next tick will re-probe; there is nothing
            // left here to confirm against.
            if (!reading) return;

            this.rundown.reconcile(reading);
            const onAir = this.rundown.nowPlaying()?.item.id;
            if (onAir !== undefined && onAir !== before) return;
        }

        // Not a failure: the player took the command (it answered), it simply has
        // not started anything this process handed it — most likely because the
        // queue behind the skip was empty and the mount has fallen to the bed.
        this.logger.info('playout: the skip landed but no new item was on air within the confirm budget');
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

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
