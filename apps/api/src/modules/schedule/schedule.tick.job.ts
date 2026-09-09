import { Container, Injectable } from 'injectkit';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { ActivityRecorder } from '#modules/activity/activity.recorder.js';
import { DirectorConsoleService } from '#modules/director/director.console.service.js';
import { DirectorService } from '#modules/director/director.service.js';
import { isChartSource, type ScheduleSlot, type ScheduleSlotSource } from '#modules/director/schedule.js';
import type { PutOnAirInput } from '#modules/director/types/director.types.js';
import { PlainJob } from '#modules/jobs/plain.job.js';
import { errorText } from '#modules/shared/error.text.js';
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
 * A station with no schedule is left alone, which is every station before somebody opens the page.
 *
 * And a slot whose playlist has nothing to play is DECLINED rather than aired: what is on stays on.
 * Taking a station off air because a playlist emptied is the worse failure and the same call the
 * audience gate makes in only letting a positive reading close it.
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
        context: JobContext,
        container: Container,
        logger: Logger,
    ) {
        super(context, container, logger);
    }

    protected async execute(): Promise<void> {
        // Off air is not a mismatch to fix. See the note above.
        if (!this.director.status().active) return;

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
            if (airing !== undefined) await this.sustain();
            return;
        }

        if (airing === slot.id) return;

        await this.changeOver(slot, airing);
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
     */
    private async changeOver(slot: ScheduleSlot, from: string | undefined): Promise<void> {
        try {
            await this.console.putOnAir(
                {
                    name: slot.label,
                    ...sourceInput(slot.source),
                    ...(slot.brief === undefined ? {} : { brief: slot.brief }),
                    // Copied onto the running order beside the brief, for the brief's own reason:
                    // `onEnd: 'extend'` keeps asking for more, and a period held anywhere but the
                    // order would last one batch.
                    ...(slot.era?.from === undefined ? {} : { eraFrom: slot.era.from }),
                    ...(slot.era?.to === undefined ? {} : { eraTo: slot.era.to }),
                    ...(slot.personaId === undefined ? {} : { personaId: slot.personaId }),
                    // Absent leaves the station's own setting standing, which is the same three-way
                    // `putOnAir` gives an operator briefing by hand. Passing `false` for an unset
                    // slot would have every scheduled show overrule a station that takes calls.
                    ...(slot.callins === undefined ? {} : { callins: slot.callins }),
                    mode: slot.mode,
                    onEnd: slot.onEnd,
                },
                slot,
            );
        } catch (error) {
            // An empty playlist arrives as the 422 the console would have shown an operator, and a
            // plugin that is gone or refusing arrives as its own status. All of them mean the same
            // thing here: this slot cannot be aired, so the station keeps doing what it was doing.
            this.logger.warn(`schedule: could not change over to "${slot.label}", so the station keeps what it is airing (${errorText(error)})`);
            // Once per slot rather than once a minute. What caused this is still true on the next
            // pass, so without the mark a slot whose playlist has emptied would write a row sixty
            // times an hour until somebody noticed.
            this.say(`slot:${slot.id}`, {
                kind: 'schedule.declined',
                detail: `The schedule asked for ${named(slot)} and it could not be aired, so the station kept what was on.`,
                data: { slot: slot.id, label: slot.label },
            });
            return;
        }

        this.notices.settled();
        this.logger.info('schedule: the station changed over', { slot: slot.id, label: slot.label, from });
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
    private say(notice: string, event: { kind: string; detail: string; data?: Record<string, unknown> }): void {
        if (!this.notices.shouldSay(notice)) return;

        void this.activity.record({ module: 'director', ...event });
    }
}

/** What to call a slot in a sentence, for one the operator never labelled. */
const named = (slot: ScheduleSlot): string => (slot.label.trim().length > 0 ? `"${slot.label.trim()}"` : 'its next slot');

/**
 * A slot's source as the half of `PutOnAirInput` that names one.
 *
 * One function rather than two ternaries at the call site, because the two arms are alternatives
 * and spelling them inline is how a changeover ends up sending both. A slot with no source spreads
 * nothing, which is what a stretch of the day the station fills itself already meant.
 */
function sourceInput(source: ScheduleSlotSource | undefined): Partial<PutOnAirInput> {
    if (source === undefined) return {};
    if (isChartSource(source)) return { chartId: source.chartId, ...(source.chartOrder === undefined ? {} : { chartOrder: source.chartOrder }) };

    return { pluginId: source.pluginId, playlistId: source.playlistId };
}
