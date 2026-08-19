import { Container, Injectable } from 'injectkit';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { ActivityRecorder } from '#modules/activity/activity.recorder.js';
import { DirectorConsoleService } from '#modules/director/director.console.service.js';
import { DirectorService } from '#modules/director/director.service.js';
import type { ScheduleSlot } from '#modules/director/schedule.js';
import { PlainJob } from '#modules/jobs/plain.job.js';
import { errorText } from '#modules/shared/error.text.js';
import { ScheduleService } from './schedule.service.js';

/**
 * The clock, asking whether the station is airing what it should be.
 *
 * ## It is a timer and never an authority
 *
 * `docs/decisions/on-air-ownership.md` states the invariant this exists inside: **the schedule says
 * WHAT should be on air, and never WHEN the changeover happens.** All this does is notice a
 * mismatch and post the same command the operator's own button posts. Where the boundary actually
 * falls is the director's business — `Rundown.retract()` reclaims what was handed over and not
 * heard and leaves the airing record playing, which is "finish the track, then swap" already built.
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
        const slot = await this.schedule.inForce();
        if (slot === undefined) return;

        const airing = this.director.order()?.slotId;
        if (airing === slot.id) return;

        await this.changeOver(slot, airing);
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
                    ...(slot.source === undefined ? {} : { pluginId: slot.source.pluginId, playlistId: slot.source.playlistId }),
                    ...(slot.brief === undefined ? {} : { brief: slot.brief }),
                    ...(slot.personaId === undefined ? {} : { personaId: slot.personaId }),
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
            void this.activity.record({
                // `director` rather than an arm of its own. The module is the console's only filter
                // axis and a changeover is a fact about what the station is AIRING, which is where
                // `air.on` and `order.*` already sit; who caused it is what `kind` says.
                module: 'director',
                kind: 'schedule.declined',
                detail: `The schedule asked for ${named(slot)} and it could not be aired, so the station kept what was on.`,
                data: { slot: slot.id, label: slot.label },
            });
            return;
        }

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
}

/** What to call a slot in a sentence, for one the operator never labelled. */
const named = (slot: ScheduleSlot): string => (slot.label.trim().length > 0 ? `"${slot.label.trim()}"` : 'its next slot');
