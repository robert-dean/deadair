import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { annotateUri, itemAnnotations } from './annotate.js';
import { AudienceWatch } from './audience.watch.js';
import { PLAYOUT_LEAD, PlayoutControlClient } from './liquidsoap.control.js';
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
 * Liquidsoap resolves (and, for an http uri, downloads) queued items while the
 * current one plays, so this is the lead the fetch needs and what keeps a
 * boundary gapless. Zero would mean pushing at the boundary itself, and any
 * hesitation there drops the mount for a moment.
 *
 * It has to match the queue's `prefetch`, which is why it comes from the shared
 * {@link PLAYOUT_LEAD}: handing over more than Liquidsoap will resolve leaves
 * items sitting unfetched, which is exactly the state a skip cannot land in.
 */
const LEAD = PLAYOUT_LEAD;

/**
 * How many items to keep handed over while the station is NOT on air.
 *
 * Off air is not idle. Liquidsoap does not consume a queue it is not airing (the
 * programme sits behind a `switch` on deadair's lease, and an unselected source
 * is never pulled), so an item handed over now is an item already resolved and
 * downloaded the moment the lease is renewed. That is the difference between the
 * first listener hearing music and hearing a few seconds of silence while a
 * track is fetched.
 *
 * One rather than {@link LEAD}, because the whole point is a fast start and only
 * the first item buys that. Three would be three provider fetches and three
 * downloads held for a mount nobody is listening to.
 */
const WARM_LEAD = 1;

/**
 * How long a warm item is trusted before it is thrown away and fetched again.
 *
 * A resolved uri is perishable: the Spotify shim signs them, and a provider
 * token behind one expires. An item pushed at midnight and first played at
 * breakfast would fail to resolve in front of the listener it was kept for,
 * which is the one moment this is supposed to protect.
 */
const WARM_STALE_MS = 15 * 60 * 1000;

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
    /** When the current warm item was handed over, so a stale one can be replaced. Unset while on air. */
    private warmedAt?: number;

    constructor(
        private readonly rundown: Rundown,
        private readonly control: PlayoutControlClient,
        private readonly audience: AudienceWatch,
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

        // The audience gate. Only the OPENING edge is acted on, and only to bring the
        // reconcile forward: the first listener should not wait out a tick to hear
        // something.
        //
        // The closing edge is deliberately not handled at all. Letting the lease lapse
        // takes the station off air within CONTROL_TTL_S, and by then nobody has been
        // listening for a full linger window, so there is no ear for the difference.
        // Handing the mount back explicitly would also drop Liquidsoap's queue,
        // throwing away the resolved item that is the whole point of staying warm. The
        // operator's own Stop still releases, because that one is heard.
        this.unsubscribes.push(
            this.audience.onChange(open => {
                if (open) this.tick();
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
            // Asserted only while there is a programme AND somebody to hear it.
            //
            // The first half is the dead-man switch: an app that is merely running must
            // not hold a mount it has nothing to put on, which is precisely the state a
            // restart leaves behind, with the rundown empty and Liquidsoap still holding
            // an item from a process that no longer exists.
            //
            // The second is the audience gate. Producing audio costs a provider fetch
            // and a download per track, and an empty mount is the one case where nobody
            // benefits from spending them. `always` mode opens the gate permanently and
            // gets exactly the behaviour this loop had before the gate existed.
            const onAir = this.onAirNow();
            const reading = onAir ? await this.control.assertOnAir() : await this.control.status();
            // Stream not up, or not yet reachable. Try again next tick.
            if (!reading) return;

            // Make the reading the truth BEFORE deciding what to hand over: it settles
            // what is on air, retires an item the player has stopped producing, and
            // takes back anything the player turns out not to be holding — so the
            // top-up below pushes against the player's real depth rather than our
            // memory of it.
            this.rundown.reconcile(reading);

            // A warm item that has been sitting too long is dropped and fetched again
            // rather than kept: see WARM_STALE_MS. Safe here and nowhere else, because
            // off air there is nothing to interrupt, and the top-up below immediately
            // hands over a freshly resolved replacement.
            if (!onAir && (await this.rewarmIfStale(reading.queued))) return;

            // Whichever of the two says the player is holding MORE.
            //
            // `queued` counts pending requests and the ones the prefetch has resolved,
            // but NOT the one it is currently resolving — so during a download it
            // under-reports, and topping up against it alone hands over an extra item
            // every pass until the fetch completes. `served` is the app's own count of
            // what it handed over, which covers the in-flight item but knows nothing
            // about requests this process never pushed — a Liquidsoap that outlived an
            // app restart is still holding those, and pushing on top of them would
            // stack the queue deeper than the lead.
            const held = Math.max(this.rundown.servedCount(), reading.queued);
            // How deep to hand over: the player's full lead while the station is on air,
            // and one warm item while it is not.
            const target = onAir ? LEAD : WARM_LEAD;
            for (let depth = held; depth < target; depth++) {
                const pulled = await this.rundown.next();
                // Nothing left: the player drains, the mount falls back to the local bed,
                // and loading a new order will wake us through onChange.
                if (!pulled) return;

                const landed = await this.control.push(annotateUri(itemAnnotations(pulled.item), pulled.url));
                if (!landed) {
                    // Already popped, so put it back at the head rather than losing it:
                    // nothing aired, and the next pass should offer the same thing again.
                    this.rundown.unserve(pulled.item.id);
                    return;
                }
                // Only a hand-over made off air is perishable in a way anything can do
                // something about: on air, the item is played within minutes.
                if (!onAir) this.warmedAt ??= Date.now();
            }
            if (onAir) this.warmedAt = undefined;
        } finally {
            this.busy = false;
        }
    }

    /**
     * Throw away a warm item that has been waiting past {@link WARM_STALE_MS}, so
     * the next pass resolves a fresh one.
     *
     * `flush` drops what is queued and leaves what the player is holding as
     * current, which off air is a frozen item rather than audio: nobody hears
     * this. The rundown takes those items back through its own reconcile of the
     * reading the flush answered with, so nothing is lost from the running order,
     * only from the player's hands.
     *
     * @returns whether it flushed, in which case the caller should stop: the
     *   depth it was about to push against has just changed.
     */
    private async rewarmIfStale(queued: number): Promise<boolean> {
        if (this.warmedAt === undefined || queued === 0) return false;
        if (Date.now() - this.warmedAt < WARM_STALE_MS) return false;

        this.warmedAt = undefined;
        const reading = await this.control.flush();
        if (!reading) return false;

        this.rundown.reconcile(reading);
        this.logger.info('playout: the item kept ready off air had gone stale; fetching it again');
        return true;
    }

    /**
     * Whether the station should be holding the mount at this instant.
     *
     * Both conditions, in one place, because they are asked together everywhere:
     * something to air, and somebody to hear it. Neither is remembered. The
     * rundown and the audience watch are each the only thing that knows its own
     * half, and a copy kept here would be the thing that goes stale.
     */
    private onAirNow(): boolean {
        return this.rundown.hasProgramme() && this.audience.gateOpen();
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
