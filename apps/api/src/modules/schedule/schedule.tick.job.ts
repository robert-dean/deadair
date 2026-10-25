import { Container, Injectable } from 'injectkit';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { PgBossJobBroker } from '@maroonedsoftware/jobbroker/pgboss';
import { IsHttpError } from '@maroonedsoftware/errors';
import { Logger } from '@maroonedsoftware/logger';
import { ActivityRecorder } from '#modules/activity/activity.recorder.js';
import type { ActivitySeverity } from '#modules/activity/station.events.repository.js';
import { DirectorConsoleService, type ScheduledNight } from '#modules/director/director.console.service.js';
import { DirectorService } from '#modules/director/director.service.js';
import type { ScheduleSlot } from '#modules/director/schedule.js';
import { slotInput } from '#modules/director/slot.input.js';
import type { RundownTrack } from '#modules/playout/rundown.js';
import { PlainJob } from '#modules/jobs/plain.job.js';
import { errorText } from '#modules/shared/error.text.js';
import { hasOverrun } from './changeover.overrun.js';
import { OPENING_WAIT_MS, OpeningWait } from './opening.wait.js';
import { PREPARE_AHEAD_MS, airsNight, type PrepareSlotPayload } from './prepare.slot.job.js';
import { promiseStillHeld } from './promise.wait.js';
import { PreparedSetRepository } from './prepared.set.repository.js';
import { ScheduleNotices } from './schedule.notices.js';
import { ScheduleService } from './schedule.service.js';

/**
 * The clock, asking whether the station is airing what it should be.
 *
 * ## It is a timer and never an authority
 *
 * The ownership rule (`docs/internals/director.md` § "Who owns the running order") states the
 * invariant this exists inside: **the schedule says WHAT should be on air, and never WHEN the
 * changeover happens.** All this does is notice a mismatch and post the same command the operator's
 * own button posts. Where the boundary actually falls is the director's business —
 * `Rundown.retract()` reclaims what was handed over and not heard and leaves the airing record
 * playing, which is "finish the track, then swap" already built.
 *
 * ## Correctness never depends on the tick
 *
 * `resolveSlot` is a pure function of the instant, so a missed minute, a paused worker or a restart
 * costs promptness and nothing else: the next run resolves the same answer and acts on it. That is
 * why a minute's cron is enough and why nothing here remembers what it did last time.
 *
 * **Do not make it coarser.** A station zone can sit at a :30 or :45 offset from the host's, so an
 * hourly tick would land in the middle of every slot rather than at its edges. Per-minute is immune
 * to that because it covers every minute of both clocks.
 *
 * **A restart needs nothing of its own, and this was checked rather than assumed.** `restore` reads
 * `station_air` back into `active` and loads the running order with the `slot_id` it was stamped
 * with, so a process that came back at 09:04 inside a boundary it slept through is a plain mismatch
 * and the next tick corrects it. Hooking the resolver into `restore` as well would have the director
 * reaching into the console service to read a playlist, which is backwards, and it would buy at most
 * the sixty seconds to the next tick. That is precisely the promptness this is allowed to cost.
 *
 * A `resume` is the same shape and deliberately gets no exemption. It picks up whatever order was
 * stopped rather than choosing one, so if the day has moved on underneath it the schedule correcting
 * it within the minute is the right answer. The takeover rule covers `putOnAir` because there the
 * operator chose a source.
 *
 * ## A gap is a real answer rather than an impossible state
 *
 * A slot is a BLOCK now: it ends when it says it ends rather than when the next one starts, so a
 * schedule may leave the afternoon unclaimed. What plays there is the sustaining source, handed over
 * exactly once — the running order ceasing to belong to any slot is the mark that it happened, which
 * is the same comparison the block case makes and needs no second piece of state.
 *
 * ## Three ways it declines, all of them ordinary
 *
 * A station that is stood down is left alone: **a schedule changes the station over, it does not put
 * it back on.** Stopping is an operator saying out of service, and the audience gate and the
 * dead-man switch already mean the station can be silent for reasons a timer must not overrule.
 *
 * **Except a station that stood down because its programme ran out**, which nobody stopped. A block
 * whose "When it runs out" is Stop goes quiet when its records are spent, and that is a fact about
 * the block: the next one still starts on time. Until `DirectorService.ranOut` said which stand-down
 * this was, the two looked the same, and one short playlist took every block after it off the air.
 * Within the block that ran out it stays quiet, since that is what Stop asked for, and the ordinary
 * comparison below is what says so: the stopped order still carries that block's id.
 *
 * A station with no schedule is left alone, which is every station before somebody opens the page.
 *
 * And a slot whose playlist has nothing to play is DECLINED rather than aired: what is on stays on.
 * Taking a station off air because a playlist emptied is the worse failure and the same call the
 * audience gate makes in only letting a positive reading close it. A playlist that could not be READ
 * is a different case and is not declined: the block starts from its brief instead. See `changeOver`.
 */
@Injectable()
export class ScheduleTickJob extends PlainJob {
    constructor(
        private readonly schedule: ScheduleService,
        private readonly console: DirectorConsoleService,
        private readonly director: DirectorService,
        private readonly activity: ActivityRecorder,
        // What has already been said, so a standing failure is one line rather than sixty an hour.
        private readonly notices: ScheduleNotices,
        // Tonight's opening records for a show that is only a brief, chosen before it starts.
        private readonly prepared: PreparedSetRepository,
        // For asking for the next show's set: see {@link prepareAhead}.
        private readonly jobs: PgBossJobBroker,
        // When a changeover started waiting for its opening: see {@link holdForOpening}.
        private readonly openingWait: OpeningWait,
        context: JobContext,
        container: Container,
        logger: Logger,
    ) {
        super(context, container, logger);
    }

    protected async execute(): Promise<void> {
        // Off air is not a mismatch to fix, unless it was a programme running out rather than
        // somebody stopping the station. See the note above.
        const active = this.director.status().active;
        if (!active && !this.director.ranOut()) return;

        await this.reconcile(active);
        // After, so nothing about preparing the next show can delay or stop this one changing over.
        await this.prepareAhead();
    }

    /** Whether the station is airing what the clock says, and the changeover when it is not. */
    private async reconcile(active: boolean): Promise<void> {
        // Resolved ONCE, for now, and carried into the changeover below. Asking twice would open a
        // window across a boundary in which the order is built from one slot's source and stamped
        // with the next slot's id, which nothing afterwards could tell from a station that is
        // already airing the right thing.
        // A HOLD: the operator said leave this alone. Checked before the schedule is even asked,
        // because the answer cannot change what happens and asking would be a query per minute for
        // nothing — the same shape as the stood-down guard above.
        //
        // This is the one thing that stops a takeover expiring silently. A manual `putOnAir` is
        // stamped with whichever slot is in force so it survives to the end of that block, which is
        // right and is also invisible: an operator who briefs the station at half past two has no
        // way to know three o'clock will take it back. A hold is them saying how long they meant.
        const held = this.director.holdUntil();
        if (held !== undefined && held > Date.now()) {
            this.say('held', {
                kind: 'schedule.held',
                detail: 'The schedule is on hold, so the station kept what an operator put on.',
            });
            return;
        }

        const slot = await this.schedule.inForce();
        const airing = this.director.order()?.slotId;

        // A GAP: no block is on. The station falls back to its sustaining source, once — the mark
        // that it already has is the running order no longer belonging to any slot, which is the
        // same comparison the block case makes and needs no second piece of state.
        if (slot === undefined) {
            if (airing !== undefined && !(active && this.holdForPromise())) await this.sustain();
            return;
        }

        if (airing === slot.id && !this.newNightNewHost(slot)) {
            // Nothing is on air to have overrun when the block has already run out.
            if (active) await this.boundOverrun(slot);
            return;
        }

        if (active && this.holdForPromise()) return;
        await this.changeOver(slot, airing, active);
    }

    /**
     * Wait a minute rather than change over now, when a break on air has just announced a record that
     * the changeover would take back.
     *
     * `putOnAir` retracts everything the player holds and lets only the item on air finish, so a
     * bulletin that ends "here is X" and is still being read at the boundary finishes in front of
     * the next programme's first record instead. On the live station that was four of fifty-five
     * changeovers in a month, among them a bulletin naming Gunship at 09:00 on 2026-10-23 followed by
     * a chart show's Tame Impala. The edit paths keep such a record put (`StationLineup.staysPut`);
     * a changeover replaces the order rather than editing it, so here the only way to keep the
     * promise is to ask again next minute, by which time the record has started and the changeover
     * lets it finish like any record on air.
     *
     * **This is `holdForOpening`'s bargain, not the refused fix of keeping the outgoing queue**:
     * nothing of the old order survives the changeover when it comes, and what moves is only WHEN the
     * tick asks. It costs the new programme one record, at only the changeovers that land inside a
     * break, and an operator's own put-on-air never comes through here. Bounded by
     * `promiseStillHeld`, so a transport that goes on calling a break on air cannot hold the last
     * programme on with it. A break that is only HANDED is not a reason: the changeover retracts it
     * with its record, so nothing it said reaches anybody.
     */
    private holdForPromise(): boolean {
        const promise = this.console.promiseOnAir();
        if (promise === undefined || !promiseStillHeld(promise.startedAt, promise.durationMs, Date.now())) return false;

        const { record } = promise;
        this.logger.info('schedule: a break on air announced the next record, so the changeover waits for it', {
            item: promise.breakItemId,
            record: record.itemId,
        });
        this.say(`promise:${promise.breakItemId}`, {
            kind: 'schedule.waited',
            detail: `A break on air had just announced "${record.title}"${record.artist.length > 0 ? ` by ${record.artist}` : ''}, so the station is playing it before changing over.`,
            data: { item: promise.breakItemId, record: record.itemId },
        });
        return true;
    }

    /**
     * Ask for the next show's opening records, when it is only a brief and starts soon.
     *
     * Asked of the clock {@link PREPARE_AHEAD_MS} from now, which tells this which show will be on
     * then and decides nothing about now: the changeover still resolves for the present instant, and
     * a set prepared for a show that never airs is a wasted refill rather than a wrong one.
     *
     * Sent every minute until the set is there, which is what makes a lost send or a failed run cost
     * nothing: `schedule.prepare_slot` runs one at a time and a run that finds the set returns. Never
     * throws, because a station that cannot prepare a show must still change over to it.
     */
    private async prepareAhead(): Promise<void> {
        const ahead = Date.now() + PREPARE_AHEAD_MS;
        // A hold that outlasts the next boundary keeps the station where it is, so that show will not
        // open at its start and there is nothing to prepare for. One that lapses before it is the
        // operator holding until the next show, which is exactly the one to be ready for.
        const held = this.director.holdUntil();
        if (held !== undefined && held > ahead) return;

        try {
            const next = await this.schedule.inForce(new Date(ahead));
            if (next === undefined || next.source !== undefined) return;

            const { date } = this.schedule.nightOf(next, ahead);
            const order = this.director.order();
            // Already on air for that night, so its moment has passed.
            if (airsNight(order, next.id, date)) return;
            if ((await this.prepared.forNight(next.id, date)) !== undefined) return;

            await this.jobs.send('schedule.prepare_slot', { slotId: next.id, occurrence: date } satisfies PrepareSlotPayload);
        } catch (error) {
            this.logger.warn(`schedule: could not ask for the next show to be prepared (${errorText(error)})`);
        }
    }

    /**
     * Cut a record from the programme that has just ended, once it has kept this block waiting as long
     * as the station allows.
     *
     * The one thing here that acts on the transport, and it still decides nothing about WHEN the
     * changeover happens: that already happened, the director let the record on air finish as it
     * always does, and this only puts a ceiling on how long "finish" may take. Off unless an operator
     * set one — see `changeover.overrun.ts` for why, and for the second clock `hasOverrun` reads.
     *
     * Stateless like the rest of the tick. The record being cut is in no running order, which is how
     * `overrunning` recognises it, and once it is cut the record on air belongs to this block and the
     * question answers itself.
     */
    private async boundOverrun(slot: ScheduleSlot): Promise<void> {
        const cap = this.schedule.overrunCap();
        if (cap === undefined) return;

        const record = this.console.overrunning();
        if (record === undefined) return;

        const now = Date.now();
        if (!hasOverrun(this.schedule.minutesInto(slot, now), record.startedAt, now, cap)) return;

        const fadeMs = this.schedule.overrunFadeMs();
        if (!(await this.console.cutOverrun(record.itemId, fadeMs))) {
            // Once per record rather than once a minute, on `say`'s argument: the stream refusing a cut
            // is still true next minute, and the next minute tries again anyway.
            this.logger.warn('schedule: a record from the last programme ran past its limit, but the stream did not take the cut');
            this.say(`overrun:${record.itemId}`, {
                kind: 'schedule.overrun',
                severity: 'warn',
                detail: `"${record.title}" ran ${cap === 1 ? 'a minute' : `${cap} minutes`} into ${named(slot)} and could not be cut, so it is still playing.`,
                data: { slot: slot.id, item: record.itemId },
            });
            return;
        }

        this.logger.info('schedule: cut a record from the last programme that ran past its limit', { slot: slot.id, item: record.itemId, cap });
        void this.activity.record({
            module: 'director',
            kind: 'schedule.overrun',
            detail: `"${record.title}" ran ${cap === 1 ? 'a minute' : `${cap} minutes`} into ${named(slot)}, so the station ${fadeMs > 0 ? 'faded it out' : 'cut it'} to start the show on time.`,
            data: { slot: slot.id, item: record.itemId, minutes: cap, fadeMs },
        });
    }

    /**
     * Hand the station to its sustaining source, because a block ended and nothing follows it.
     *
     * A schedule need not cover the day, and this is the whole of what makes ending a block mean
     * anything: without it the station would carry on with whatever the last block left it, which is
     * indistinguishable from that block never having ended.
     *
     * **Never silence.** A gap plays something, or the station keeps what it has — so the schedule
     * can never take a running station off air, which is what keeps `Stop` meaning only what an
     * operator meant by it and leaves the mount lease and the audience gate as the only things
     * deciding whether anybody is hearing this.
     *
     * A station that has named no sustaining source therefore carries on and says so on the feed
     * ONCE rather than every minute: the running order still belongs to the block that ended, so the
     * guard above stops this repeating until something changes it.
     */
    private async sustain(): Promise<void> {
        const source = this.schedule.sustaining();
        if (source === undefined) {
            this.say('gap:unset', {
                kind: 'schedule.gap',
                detail: 'The schedule ran out and there is nothing set to play between blocks, so the station kept what was on.',
            });
            return;
        }

        try {
            await this.console.putOnAir(
                {
                    name: 'Sustaining',
                    ...(source.chartId !== undefined
                        ? { chartId: source.chartId, ...(source.chartOrder === undefined ? {} : { chartOrder: source.chartOrder }) }
                        : source.pluginId === undefined || source.playlistId === undefined
                          ? {}
                          : { pluginId: source.pluginId, playlistId: source.playlistId }),
                    ...(source.brief === undefined ? {} : { brief: source.brief }),
                    ...(source.era?.from === undefined ? {} : { eraFrom: source.era.from }),
                    ...(source.era?.to === undefined ? {} : { eraTo: source.era.to }),
                    // Always said, so the gaps take calls exactly when the sustaining source was told
                    // to and never because of a station-wide default.
                    callins: source.callins,
                    mode: 'rotation',
                    onEnd: 'extend',
                },
                // No slot to hand back — that is what a gap IS — so the clock says so directly.
                // Without it a sustaining broadcast and one an operator started during the same gap
                // are the same row, and the desk would tell them the schedule is driving when it is
                // not.
                undefined,
                true,
            );
        } catch (error) {
            this.logger.warn(`schedule: could not hand the station to its sustaining source, so it keeps what it is airing (${errorText(error)})`);
            this.say('gap:failed', {
                kind: 'schedule.declined',
                detail: 'The schedule ran out and the sustaining source could not be aired, so the station kept what was on.',
            });
            return;
        }

        this.notices.settled();

        this.logger.info('schedule: the schedule ran out, so the station moved to its sustaining source');
        void this.activity.record({
            module: 'director',
            kind: 'schedule.sustaining',
            detail: 'Nothing is scheduled now, so the station moved to what it plays between blocks.',
        });
    }

    /**
     * Put the station on what the clock says, through the operator's own path.
     *
     * `DirectorConsoleService.putOnAir` rather than a second copy of it, so a changeover means the
     * same thing whichever pressed it: the same playlist read, the same binding, the same
     * synchronous epoch bump before the same posted command. A job scope carries a trusted system
     * actor, so the permission narrowing on the playlist read passes rather than needing a way
     * round it.
     *
     * ## A source that cannot be READ is not a source that is empty
     *
     * A 422 is the station's own verdict on a playlist it did read: nothing on it, nothing it may
     * play, nothing in the library yet. That is declined, and what is on stays on, because airing the
     * slot anyway would be the station overruling what the operator's playlist says.
     *
     * Anything else is the read itself failing — a provider timing out on a long playlist, a plugin
     * quarantined or switched off, a station playlist deleted — and declining that is how one slow
     * provider kept a previous block on air through the three after it, each changeover refused
     * every minute for its whole length. So the block starts WITHOUT its source instead, as a
     * rotation from its own brief, period and host, which is everything the operator said about
     * this stretch of the day except where its records come from. It is not retried within the
     * block: the order is stamped with this slot, so the tick has nothing to reconcile until the
     * next one, and a retry would need state the tick deliberately does not hold.
     */
    private async changeOver(slot: ScheduleSlot, from: string | undefined, active: boolean): Promise<void> {
        // Which night this is and who presents it, read once for both attempts below so the order
        // cannot be built for one host and stamped for another.
        const { date, host, coHosts } = this.schedule.nightOf(slot);
        // Only a slot with no source is prepared for: one with a playlist or a chart has its records
        // at the boundary already. See `PreparedSetRepository`.
        const opening = slot.source === undefined ? await this.preparedFor(slot, date) : undefined;
        if (opening !== undefined && (await this.holdForOpening(slot, date, opening, active))) return;
        const prepared = opening?.tracks;
        const night: ScheduledNight = {
            date,
            guest: host.guest,
            ...(host.regularPersonaId === undefined ? {} : { regularPersonaId: host.regularPersonaId }),
            ...(coHosts.length === 0 ? {} : { coHostIds: coHosts }),
            ...(prepared === undefined ? {} : { prepared }),
        };

        let withoutSource: unknown;
        try {
            await this.console.putOnAir(slotInput(slot, { host }), slot, false, night);
        } catch (error) {
            if (slot.source === undefined || refusedItsSource(error)) {
                this.decline(slot, error);
                return;
            }

            withoutSource = error;
            try {
                await this.console.putOnAir(slotInput(slot, { withoutSource: true, host }), slot, false, night);
            } catch (fallbackError) {
                this.decline(slot, fallbackError);
                return;
            }
        }

        this.notices.settled();
        this.openingWait.clear();
        this.logger.info('schedule: the station changed over', { slot: slot.id, label: slot.label, from, prepared: prepared?.length ?? 0 });
        // Aired, so it is spent. Kept when the changeover was declined, since the next minute's tick
        // tries the same night again.
        if (prepared !== undefined) await this.discardPrepared(slot);

        if (withoutSource !== undefined) {
            this.logger.warn(
                `schedule: could not read the source for "${slot.label}", so it started from its brief instead (${errorText(withoutSource)})`,
            );
            void this.activity.record({
                module: 'director',
                kind: 'schedule.changeover',
                severity: 'warn',
                detail: `The station moved to ${named(slot)} on the schedule, but its playlist could not be read, so the station is choosing the records itself from what the slot asks for.`,
                data: { slot: slot.id, label: slot.label, withoutSource: true, ...(from === undefined ? {} : { from }) },
            });
            return;
        }

        void this.activity.record({
            module: 'director',
            kind: 'schedule.changeover',
            // No actor: nobody pressed anything. That absence is the point of the sentence — an
            // operator reading the feed should be able to tell a changeover they caused from one
            // the clock caused.
            detail: `The station moved to ${named(slot)} on the schedule.`,
            data: { slot: slot.id, label: slot.label, ...(from === undefined ? {} : { from }) },
        });
    }

    /**
     * Whether the slot on air has moved on to a NEW night with a different host, which the slot id
     * alone cannot see.
     *
     * A block that runs straight through midnight into its next run is the same id on both nights, so
     * a guest host on the second night would never take over. The order is stamped with the date its
     * night began; when today's night is a different date AND its host differs from that night's, the
     * station changes over as it would at any boundary. Both hosts are worked out from the schedule
     * rather than read off the order, so an operator who recast the show by hand is not overruled
     * mid-night: only the next night's start can change it. An order with no stamp was placed by a
     * person, or before stamps existed, and is left alone.
     */
    private newNightNewHost(slot: ScheduleSlot): boolean {
        const placed = this.director.order()?.slotOccurrence;
        if (placed === undefined) return false;

        const now = this.schedule.nightOf(slot);
        if (now.date === placed) return false;

        const then = this.schedule.hostOn(slot, placed);
        // The host, or who is beside them: a visiting co-host's night starts at the top of the show
        // like a guest host's does, and so does the night after it, when they have gone again.
        return then?.personaId !== now.host.personaId || (then?.coHosts ?? []).join('|') !== now.coHosts.join('|');
    }

    /**
     * Tonight's prepared set, if there is one, and whether the read worked at all. A read that fails
     * is no set: the show opens empty and refills, which is what every brief-only show did before
     * anything was prepared, and is far better than a changeover that does not happen. It is also no
     * reason to wait for one (see {@link holdForOpening}), which is why the two are told apart.
     */
    private async preparedFor(slot: ScheduleSlot, date: string): Promise<{ read: boolean; tracks?: RundownTrack[] }> {
        try {
            const tracks = await this.prepared.forNight(slot.id, date);
            return tracks === undefined ? { read: true } : { read: true, tracks };
        } catch (error) {
            this.logger.warn(`schedule: could not read the set prepared for "${slot.label}", so it opens without one (${errorText(error)})`);
            return { read: false };
        }
    }

    /**
     * Keep the show going off on air for a few minutes while the one coming on has its opening chosen,
     * when nothing was chosen ahead of it.
     *
     * {@link prepareAhead} chooses a brief-only show's first records ten minutes before it starts, and
     * at a boundary on the clock that is enough. It cannot help a show that comes into force WITHOUT
     * that warning: one an operator adds or moves over the present, which on the live station was every
     * empty changeover after the look-ahead shipped (Neon Drive at 11:12 and Throwback Thursday at
     * 18:56 on 2026-10-08, Saturday Requests at 15:55 on 2026-10-10, each changed over within a minute
     * of being added). Each went on air with an empty order and was silent until the refill came back,
     * about two minutes every time. A set that was asked for and never arrived (a model too busy, a job
     * that ran out of time) is the same case reached the slow way.
     *
     * So the changeover is held and the set asked for now, and the next tick that finds it changes over
     * onto it. **This is not the refused fix of keeping the outgoing show's queue** (director.md, "Who
     * owns the running order"): `putOnAir` still retracts first and builds a new order, and nothing
     * about the outgoing broadcast is kept past its changeover. What moves is only WHEN the tick asks,
     * which is the one thing the tick was always allowed to cost.
     *
     * Only while there is something to hold: an order with records still planned, on a station that is
     * on air. A station that ran out, or an order with nothing left, changes over at once, since holding
     * it would be holding silence. Bounded by {@link OPENING_WAIT_MS}, after which it changes over
     * without a set as it always did, and a set that cannot be read or asked for is never waited on.
     */
    private async holdForOpening(
        slot: ScheduleSlot,
        date: string,
        opening: { read: boolean; tracks?: RundownTrack[] },
        active: boolean,
    ): Promise<boolean> {
        if (!opening.read || opening.tracks !== undefined) return false;
        if (!active || this.director.status().remaining === 0) return false;

        const heldFor = this.openingWait.heldFor(`${slot.id}:${date}`, Date.now());
        if (heldFor >= OPENING_WAIT_MS) {
            this.logger.warn(`schedule: "${slot.label}" was not ready after waiting for its opening, so it starts without one`, {
                slot: slot.id,
                heldForMs: heldFor,
            });
            return false;
        }

        try {
            // Every minute of the wait, for `prepareAhead`'s reason: a lost send or a failed run costs
            // nothing, and a run behind the one that prepared it finds the set and returns.
            await this.jobs.send('schedule.prepare_slot', { slotId: slot.id, occurrence: date } satisfies PrepareSlotPayload);
        } catch (error) {
            this.logger.warn(`schedule: could not ask for "${slot.label}" to be prepared, so it starts without an opening (${errorText(error)})`);
            return false;
        }

        if (heldFor === 0) {
            this.logger.info('schedule: holding the changeover while the next show has its opening chosen', { slot: slot.id, label: slot.label });
        }
        this.say(`opening:${slot.id}:${date}`, {
            kind: 'schedule.waiting',
            detail: `${named(slot)} has no records chosen yet, so the station is choosing them before it changes over rather than going quiet while it does.`,
            data: { slot: slot.id, label: slot.label },
        });
        return true;
    }

    /**
     * Let a prepared set go after it aired. Logged rather than thrown: the station has already changed
     * over, and a row left behind is for a night that has started, so nothing will air it twice.
     */
    private async discardPrepared(slot: ScheduleSlot): Promise<void> {
        try {
            await this.prepared.discard(slot.id);
        } catch (error) {
            this.logger.warn(`schedule: could not let go of the set prepared for "${slot.label}" (${errorText(error)})`);
        }
    }

    /** This slot cannot be aired at all, so the station keeps doing what it was doing. */
    private decline(slot: ScheduleSlot, error: unknown): void {
        this.logger.warn(`schedule: could not change over to "${slot.label}", so the station keeps what it is airing (${errorText(error)})`);
        // Once per slot rather than once a minute. What caused this is still true on the next
        // pass, so without the mark a slot whose playlist has emptied would write a row sixty
        // times an hour until somebody noticed.
        this.say(`slot:${slot.id}`, {
            kind: 'schedule.declined',
            detail: `The schedule asked for ${named(slot)} and it could not be aired, so the station kept what was on.`,
            data: { slot: slot.id, label: slot.label },
        });
    }

    /**
     * Put something on the feed, unless it is what was said last.
     *
     * Every failure here is STICKY — what caused it is still true on the next pass — so the edge
     * cannot be spotted from anything the tick can read. `ScheduleNotices` holds it instead. The
     * recorder is voided as everywhere else: nothing reads these rows to decide anything.
     *
     * `director` rather than an arm of its own, because the module is the console's only filter axis
     * and all of this is a fact about what the station is AIRING, which is where `air.on` and
     * `order.*` already sit. Who caused it is what `kind` says.
     */
    private say(notice: string, event: { kind: string; detail: string; severity?: ActivitySeverity; data?: Record<string, unknown> }): void {
        if (!this.notices.shouldSay(notice)) return;

        void this.activity.record({ module: 'director', ...event });
    }
}

/** What to call a slot in a sentence, for one the operator never labelled. */
const named = (slot: ScheduleSlot): string => (slot.label.trim().length > 0 ? `"${slot.label.trim()}"` : 'its next slot');

/**
 * The station's own verdict on a source it read, as opposed to a read that failed.
 *
 * A 422 that no plugin is named on: `sourceTracks` answers one for a playlist with nothing on it,
 * nothing the station may play, or nothing in the library yet. A plugin's own `config` failure is a
 * 422 too, but `pluginHttpError` names the plugin in its details, and a misconfigured plugin is a
 * read that failed rather than a verdict on the playlist. Every other status, and anything that is
 * not an HTTP error at all, is likewise the read failing, which is what
 * {@link ScheduleTickJob.changeOver} starts the block without its source for.
 */
const refusedItsSource = (error: unknown): boolean => IsHttpError(error) && error.statusCode === 422 && error.details?.['plugin'] === undefined;
