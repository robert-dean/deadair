import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { Heartbeat, HEARTBEATS } from '#modules/shared/heartbeat.js';
import { annotateUri, blendOutOf, itemAnnotations } from './annotate.js';
import { AudienceWatch } from './audience.watch.js';
import { TARGET_LUFS_KEY, resolveTargetLufs } from './gain.js';
import { PLAYOUT_LEAD, PlayoutControlClient, type QueueStatus } from './liquidsoap.control.js';
import { Rundown, type RundownItem } from './rundown.js';

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
 * How many items to hand over while the station is NOT on air. None.
 *
 * This looks like a missed optimisation and is not. An item pushed while the
 * gate is shut was supposed to sit there resolved, so the first listener heard
 * music instead of a fetch. **Liquidsoap does not work that way, measured on the
 * running stack:** with `driving` false the reading's `remainingMs` still falls
 * in lockstep with the wall clock, because a source inside the streaming graph
 * keeps being ticked by its clock whether or not the gate above it selects it.
 * The item plays out to nobody.
 *
 * Which turns a warm queue into precisely the thing this whole gate exists to
 * stop: the station works through its lineup, one provider fetch and one
 * download per track, for an empty mount. It also breaks resume-where-it-stopped,
 * because the running order advances while nobody is listening.
 *
 * So the queue stays empty until somebody is there, and the fetch happens in
 * front of the first listener. Freezing it instead would take a change in
 * `radio.liq` (a separate clock, or `source.dynamic`), not a constant here.
 */
const WARM_LEAD = 0;

/**
 * Safety net for anything that does not emit a change: a restart, a dropped push.
 *
 * Exported because it is also the yardstick for how long a gap in the running
 * order has to last before it means anything: anything shorter than one pass of
 * this loop is the queue being topped up, which is why `PlayoutService.noteStarve`
 * judges a gap against it rather than against a second number that could drift.
 */
export const RECONCILE_TICK_MS = 2000;

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
    /**
     * What the last pass threw, cleared by the next one that does not.
     *
     * Deliberately here rather than in {@link Heartbeat}: a loop that threw and came
     * round again is still ALIVE, which is all the heartbeat measures, and folding the
     * two together would leave a reader unable to tell a loop that stopped from one
     * that is failing every pass. Those are two faults with two different fixes.
     */
    private lastFailure?: { at: number; message: string };
    /**
     * The blend stamped on the LAST boundary handed over, so the next item can carry
     * the same number as its start buffer.
     *
     * Held here rather than derived, because by the time the incoming item is handed
     * over the running order may have moved and a second computation would not agree
     * with the first. Zero after a reset: whatever the player was holding is gone, so
     * the next item begins a boundary with nothing on the other side of it.
     */
    private previousBlendMs = 0;

    constructor(
        private readonly rundown: Rundown,
        private readonly control: PlayoutControlClient,
        private readonly audience: AudienceWatch,
        private readonly config: AppConfig,
        private readonly heartbeat: Heartbeat,
        private readonly logger: Logger,
    ) {}

    /**
     * Whether this loop is still going round, and what it last complained about.
     *
     * Read by the silence diagnosis, and the reason it can be: `PlayoutControlClient`
     * sets `isUp` and `isOnAir` from the calls made in here, so a loop that has stopped
     * leaves both frozen at whatever they last said and every other reading looks fine
     * while the mount lease expires.
     */
    health(now = Date.now()): { stalledForMs?: number; failure?: { at: number; message: string } } {
        const stalledForMs = this.heartbeat.stalledFor(HEARTBEATS.playoutReconcile, now);
        return {
            ...(stalledForMs === undefined ? {} : { stalledForMs }),
            ...(this.lastFailure === undefined ? {} : { failure: this.lastFailure }),
        };
    }

    /**
     * The station's target level, as the setting currently stands.
     *
     * Read per hand-over rather than held, exactly as {@link AudienceWatch} reads
     * the air mode: `AppConfig` is a live view over `deadair.settings`, so a
     * target an operator changes takes effect on the next record handed to the
     * player without anything having to be told about it.
     */
    private targetLufs(): number {
        return resolveTargetLufs(this.config.get(TARGET_LUFS_KEY, ''));
    }

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
                // Whatever the player was holding is going away, so the next item handed over
                // is not the far side of any boundary. Left alone it would stamp a start
                // buffer against a record that no longer precedes it.
                this.previousBlendMs = 0;
                // An armed cue belongs to a record that is no longer going to air, either way.
                // `/control/offair` clears it too, but a replacement does not go through that, and
                // a cue left armed would fire over the first record of the NEW running order.
                void this.control.clearVoice().catch(() => undefined);
            }),
        );

        // The one moment the station can honestly say what a listener is hearing.
        // Announced rather than left to the annotation on the pushed uri, which rides a
        // track boundary the output cannot always see: see `PlayoutControlClient.announce`.
        this.unsubscribes.push(this.rundown.onAired(item => this.announce(item)));

        // The audience gate. Only the opening edge needs a nudge, to bring the reconcile
        // forward so the first listener is not waiting out a tick before anything is
        // even handed over. Closing is handled by the reconcile itself, which is the one
        // place that knows what the player is actually holding: see `handBack`.
        //
        // Opening also re-announces what is airing. Coming back on air mid-track is
        // precisely the case with no boundary left to carry a label, so the first
        // listener would otherwise be told about whatever the mount last heard of.
        this.unsubscribes.push(
            this.audience.onChange(open => {
                if (!open) return;

                this.tick();
                const airing = this.rundown.nowPlaying()?.item;
                if (airing) this.announce(airing);
            }),
        );

        this.heartbeat.register(HEARTBEATS.playoutReconcile);
        this.timer = setInterval(() => this.tick(), RECONCILE_TICK_MS);
        this.timer.unref?.();
        this.logger.info(`playout: pushing the rundown to liquidsoap (lead ${LEAD}, reconciling every ${RECONCILE_TICK_MS}ms)`);
    }

    /** Stop draining. The player keeps playing whatever it already holds. */
    stop(): void {
        if (this.timer) clearInterval(this.timer);
        this.timer = undefined;
        // Stopped on purpose, so it should not be reported as a loop that died. A
        // shutdown is the only caller.
        this.heartbeat.forget(HEARTBEATS.playoutReconcile);
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

        // Whether this pass got all the way round, which is not the same as it having
        // done anything: the several early returns below are completed passes, and the
        // only exit that is not is a throw. Beating in the `finally` without this would
        // report a loop that fails instantly on every tick as a healthy one.
        let threw = false;
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

            // Off air with the player still holding something: take it back. Every pass
            // rather than only on the falling edge, because the state has causes that
            // are not edges — an app restarting in front of a Liquidsoap that outlived
            // it, a release that did not land, a mode changed while nothing was running.
            if (!onAir && (await this.handBack(reading))) return;

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
                // Asked again on every iteration, not once before the loop. Each pass through here
                // spans two awaits — resolving the item and pushing it — and both of the things
                // this answer is made of can change inside either: the operator can stop the
                // station, and the last listener can leave.
                //
                // The audience case is the one that bites. A Stop empties the running order, so the
                // loop runs out of items on its own; a gate that shuts leaves the order intact, and
                // a loop trusting the reading it started with keeps filling the player's lead for a
                // mount nobody is hearing. That is exactly what WARM_LEAD exists to prevent, paid
                // for in a provider fetch and a download per track.
                if (!this.onAirNow()) return;

                const pulled = await this.rundown.next();
                // Nothing left, or the running order was replaced while this item was being
                // resolved: the player drains, the mount falls back to the local bed, and loading
                // a new order will wake us through onChange.
                if (!pulled) return;

                // The successor comes off the pull rather than being looked up here: the
                // rundown is the thing that knows the order, and a blend is sized from the
                // pair rather than from either record. It is absent at the tail of what has
                // been planned, which `blendFor` answers as a hard join.
                //
                // `previousBlendMs` is the other half of the same fact. A boundary has to be
                // stamped on BOTH records that form it — the outgoing one's end buffer and the
                // incoming one's start buffer — or `cross` takes the shorter of two numbers
                // that were never about the same boundary. See `crossAnnotations`.
                const context = {
                    targetLufs: this.targetLufs(),
                    crossfade: this.rundown.crossfade(),
                    previousBlendMs: this.previousBlendMs,
                    ...(pulled.next === undefined ? {} : { next: pulled.next }),
                };
                const landed = await this.control.push(annotateUri(itemAnnotations(pulled.item, context), pulled.url));

                // Remembered AFTER the push, so a push that did not land does not leave the
                // next item claiming to blend into a record the player never got.
                this.previousBlendMs = landed ? blendOutOf(pulled.item, context) : 0;

                // Armed as the record is handed over, which is the earliest honest moment: the id
                // exists, the item is committed, and the script waits for that record to actually
                // start before it counts anything. Arming earlier would be arming against an item
                // that might still be retracted; later there would be no "later" — the next thing
                // this loop does is hand over the record after it.
                //
                // Fire and forget, deliberately, and after the push rather than before it. A cue
                // is the one part of a hand-over the broadcast does not depend on: the record airs
                // whether or not the DJ talks over it, and holding the push up for a cue would
                // trade the thing that matters for the thing that does not.
                if (landed && pulled.voice) {
                    void this.control.armVoice(pulled.voice.url, pulled.item.id, pulled.voice.atMs).catch(() => undefined);
                }

                if (!landed) {
                    // Already popped, so put it back at the head rather than losing it:
                    // nothing aired, and the next pass should offer the same thing again.
                    this.rundown.unserve(pulled.item.id);
                    return;
                }
            }
        } catch (error) {
            threw = true;
            this.lastFailure = { at: Date.now(), message: error instanceof Error ? error.message : String(error) };
            throw error;
        } finally {
            this.busy = false;
            if (!threw) {
                this.heartbeat.beat(HEARTBEATS.playoutReconcile);
                // Cleared by a pass that worked, so what a reader sees is always the
                // failure the loop is CURRENTLY suffering rather than the last one it ever hit.
                this.lastFailure = undefined;
            }
        }
    }

    /**
     * Tell the mount what is on it.
     *
     * Fire and forget, deliberately. This runs on a track boundary, with the next
     * item being fetched behind it, and a label is not worth holding that up or
     * failing it: the audio is right whether or not the caption lands, and the
     * next boundary carries another one.
     */
    private announce(item: RundownItem): void {
        // The same line Icecast composes for itself out of the `annotate:` pair, so a
        // label that arrives this way is indistinguishable from one that rode the
        // boundary. See `itemAnnotations`.
        const artist = item.artists.join(', ');
        void this.control.announce(artist ? `${artist} - ${item.title}` : item.title).catch(() => undefined);
    }

    /**
     * Take back everything the player is holding, because nobody is listening.
     *
     * The counterpart to not pushing while the gate is shut, and just as
     * necessary: Liquidsoap consumes its queue whether or not `driving()` selects
     * it (see {@link WARM_LEAD}), so anything left there plays out to an empty
     * mount at a download per track. Not pushing only stops the station getting
     * any deeper into that.
     *
     * `releaseOnAir` rather than `flush`, because the item the player calls
     * current is being consumed too, and flush leaves it alone. Nobody hears the
     * cut: that is what the gate being shut means.
     *
     * Nothing is lost from the running order. The reading this answers with is
     * reconciled, and `Rundown.reconcile` re-queues every item the player turns
     * out not to be holding, so the station resumes where it stopped. Only the
     * part-played item is dropped.
     *
     * @returns whether it took anything back, in which case the caller should
     *   stop: the depth it was about to push against no longer exists.
     */
    private async handBack(reading: QueueStatus): Promise<boolean> {
        // Nothing held, nothing to do. Checked rather than released blindly, or this
        // would fire a command at Liquidsoap every couple of seconds forever.
        if (reading.queued === 0 && reading.onAir === undefined && reading.ready !== true) return false;

        const released = await this.control.releaseOnAir();
        if (!released) return false;

        this.rundown.reconcile(released);
        this.logger.info('playout: nobody is listening; taking back what the player was holding');
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
