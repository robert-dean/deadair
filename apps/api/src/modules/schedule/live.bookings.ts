import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { ActivityRecorder } from '#modules/activity/activity.recorder.js';
import { PlayoutControlClient } from '#modules/playout/liquidsoap.control.js';
import type { ScheduleSlot } from '#modules/director/schedule.js';
import { LiveArmRepository, type LiveArm } from './live.arm.repository.js';
import { ScheduleNotices } from './schedule.notices.js';
import { ScheduleService } from './schedule.service.js';

/**
 * What this step has already said, kept apart from the changeover's own notices because both run on
 * every tick: sharing one mark would have each clear the other's and repeat both every minute.
 */
@Injectable()
export class LiveNotices extends ScheduleNotices {}

/**
 * Booked live shows: arm the live input when one begins, and disarm it at the end if nobody came.
 *
 * A live show is a special marked `live` (migration 0121), and it is never changed over onto: the
 * weekly show underneath keeps airing until the presenter is heard, which is the input's own job.
 * All the schedule does is what an operator pressing Go live on the Desk does, at the show's time, and
 * what they would do at its end on finding nobody had turned up.
 *
 * ## Once per night
 *
 * Each night of a show is written down when it begins (`schedule_live_arms`), so the input is armed
 * once and never again that night: a Cancel pressed at the Desk, or a presenter handing back early,
 * is not undone a minute later. An input already armed, counting in or on air as the show begins
 * (somebody went live early) is left alone and written down as not armed by the schedule, so the end
 * of the show leaves it alone too.
 *
 * ## The end never cuts a presenter
 *
 * At the end of a night the schedule armed for, an input still only `armed` is disarmed, because
 * nobody came and nothing should be waiting for an encoder all night. One counting in or on air is
 * the presenter's, who hands back as they always do. A chain that cannot be read at the end closes the
 * night anyway: there is nothing to disarm that the restart has not already dropped.
 *
 * ## What it cannot tell apart
 *
 * The audio chain keeps the armed state in memory, so a Liquidsoap restart mid-show drops it, and from
 * here that is indistinguishable from a Cancel. The night is not armed again; an operator re-arms from
 * the Desk.
 *
 * It runs before the tick's stood-down guard, because under `playout.liveAutomation` = `standDown` the
 * director is inactive for the whole of a live show and the end must still be dealt with. That also
 * arms a booked show on a station somebody stopped, which is the booking doing what it says: the
 * hand-back leaves a stopped station off (`DirectorService.resumeAfterLive`).
 */
@Injectable()
export class LiveBookings {
    constructor(
        private readonly schedule: ScheduleService,
        private readonly arms: LiveArmRepository,
        private readonly control: PlayoutControlClient,
        private readonly activity: ActivityRecorder,
        private readonly notices: LiveNotices,
        private readonly logger: Logger,
    ) {}

    async run(at: Date = new Date()): Promise<void> {
        const now = await this.schedule.liveInForce(at);

        for (const arm of await this.arms.open()) {
            if (now !== undefined && arm.slotId === now.slot.id && arm.occurrence === now.night) continue;
            await this.close(arm);
        }

        if (now !== undefined && !(await this.arms.has(now.slot.id, now.night))) await this.begin(now.slot, now.night);
    }

    /** The night has begun: arm the input, unless somebody already has. */
    private async begin(slot: ScheduleSlot, night: string): Promise<void> {
        const reading = await this.control.status();
        if (reading?.live === undefined) return this.unreachable(slot);

        if (reading.live !== 'off') {
            await this.arms.record({ slotId: slot.id, occurrence: night, armed: false });
            this.logger.info('schedule: a live show began with the live input already in use, so it was left alone', {
                slot: slot.id,
                live: reading.live,
            });
            return;
        }

        const title = slot.label.trim();
        const armed = await this.control.armLive(title.length === 0 ? undefined : title);
        if (armed?.live === undefined) return this.unreachable(slot);

        await this.arms.record({ slotId: slot.id, occurrence: night, armed: true });
        this.notices.settled();
        this.logger.info('schedule: armed the live input for a booked show', { slot: slot.id, night });
        void this.activity.record({
            module: 'director',
            kind: 'schedule.live_armed',
            detail: `${named(slot)} is booked live now, so the live input was armed. The station carries on until the encoder is heard.`,
            data: { slot: slot.id, label: slot.label, night },
        });
    }

    /** The night is over: disarm an input the schedule armed that is still waiting for anybody. */
    private async close(arm: LiveArm): Promise<void> {
        if (arm.armed) {
            const reading = await this.control.status();
            if (reading?.live === 'armed') {
                const disarmed = await this.control.disarmLive();
                // Left open when the disarm did not land, so the next minute tries again.
                if (disarmed?.live === undefined) return;

                this.logger.info('schedule: nobody came for a booked live show, so the live input was disarmed', {
                    slot: arm.slotId,
                    night: arm.occurrence,
                });
                void this.activity.record({
                    module: 'director',
                    kind: 'schedule.live_unattended',
                    detail: 'A booked live show ended with nobody on the live input, so it was disarmed.',
                    data: { slot: arm.slotId, night: arm.occurrence },
                });
            }
        }

        await this.arms.close(arm.slotId, arm.occurrence);
    }

    /** Nothing written, so the next minute tries again; said once rather than every minute. */
    private unreachable(slot: ScheduleSlot): void {
        this.logger.warn('schedule: a live show is due and the audio chain did not take the arm', { slot: slot.id });
        if (!this.notices.shouldSay(`live:${slot.id}`)) return;

        void this.activity.record({
            module: 'director',
            kind: 'schedule.live_unarmed',
            severity: 'warn',
            detail: `${named(slot)} is booked live now, but the audio chain did not take the arm. It will keep trying while the show is on.`,
            data: { slot: slot.id, label: slot.label },
        });
    }
}

/** What to call a show in a sentence, for one the operator never named. */
const named = (slot: ScheduleSlot): string => (slot.label.trim().length > 0 ? `"${slot.label.trim()}"` : 'A live show');
