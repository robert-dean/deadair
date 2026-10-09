import { Container, Injectable } from 'injectkit';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { ActivityRecorder } from '#modules/activity/activity.recorder.js';
import { PickResolver } from '#modules/director/pick.resolver.js';
import { DEFAULT_COUNT, planRecords, songKeysOf } from '#modules/director/plan.records.js';
import { resolveRules, stationRules } from '#modules/director/rotation.rules.js';
import { SetGenerator } from '#modules/director/set.generator.js';
import { StationLineupRepository } from '#modules/director/station.lineup.repository.js';
import { PlainJob } from '#modules/jobs/plain.job.js';
import { TrackCachePlanner } from '#modules/playout/audio/track.cache.planner.js';
import type { RundownTrack } from '#modules/playout/rundown.js';
import { errorText } from '#modules/shared/error.text.js';
import { PreparedSetRepository } from './prepared.set.repository.js';
import { ScheduleRepository } from './schedule.repository.js';

/**
 * Optional in the type and required in practice, like every other job payload here: a registration is
 * typed against a payload the broker may deliver as `{}`. The run guards on both.
 */
export interface PrepareSlotPayload {
    slotId?: string;
    /** The date the night being prepared for begins on, `YYYY-MM-DD`, as `ScheduleService.nightOf` answers it. */
    occurrence?: string;
}

/**
 * Choose the first records of a show before it starts.
 *
 * A slot that is only a brief went on air with an empty running order and was silent until a model
 * refill and a download came back: two to three minutes a show on the live station. The tick sends
 * this {@link PREPARE_AHEAD_MS} before such a slot begins, and the changeover airs what it chose.
 * See `PreparedSetRepository`.
 *
 * **It writes nothing that airs.** The set is prepared material: the changeover hands it to
 * `putOnAir`, which posts it to the director like any playlist, and the ordinary refill takes over
 * from there. So the schedule is still a timer rather than an actor, and the director is still the
 * only writer of the running order.
 *
 * The same call `ExtendLineupJob` makes, under the rules the show will air with: the slot's mode
 * resolved against the station's rules, and the slot as its broadcast, so a never-play rule scoped to
 * it holds. A slot's own overrides are all about talk (breaks, call-ins, mixing in, chart positions),
 * so nothing about choosing records is lost by leaving them out.
 *
 * Every way it declines is ordinary, and each one leaves the show to open as it did before this
 * existed: the slot is gone or has a source now, a set is already there, the night has already
 * started, or the mode generates nothing.
 */
@Injectable()
export class PrepareSlotJob extends PlainJob<PrepareSlotPayload> {
    constructor(
        private readonly slots: ScheduleRepository,
        private readonly prepared: PreparedSetRepository,
        // Read for the songs it holds, never written: see `ExtendLineupJob`, which reads it the same way.
        private readonly order: StationLineupRepository,
        private readonly generator: SetGenerator,
        private readonly resolver: PickResolver,
        // For the opening records' audio, which the commit gate waits on: see {@link warm}.
        private readonly cache: TrackCachePlanner,
        private readonly activity: ActivityRecorder,
        private readonly config: AppConfig,
        context: JobContext,
        container: Container,
        logger: Logger,
    ) {
        super(context, container, logger);
    }

    protected async execute(payload?: PrepareSlotPayload, signal?: AbortSignal): Promise<void> {
        const slotId = payload?.slotId;
        const occurrence = payload?.occurrence;
        if (slotId === undefined || occurrence === undefined) return;

        // Read now rather than carried in the payload, so an edit made since the tick sent this is what
        // the set is chosen against.
        const slot = (await this.slots.list()).find(candidate => candidate.id === slotId);
        if (slot === undefined || slot.source !== undefined) return;

        // The tick sends this every minute until a set is there, and the queue runs one at a time, so
        // a run behind the one that prepared it finds it here and stops.
        if ((await this.prepared.forNight(slotId, occurrence)) !== undefined) return;

        const lineup = await this.order.load();
        // Too late: the night has started and opened without one. A set saved now would be for a night
        // that is already on air, and nothing would ever read it.
        if (lineup?.slotId === slotId && lineup.slotOccurrence === occurrence) return;

        const rules = resolveRules(slot.mode, undefined, stationRules(this.config));
        // A setlist or a feature: nothing generates into those, so there is nothing to prepare.
        if (!rules.mayGenerate) return;

        const planned = await planRecords(this.generator, this.resolver, {
            count: DEFAULT_COUNT,
            rules,
            ...(slot.brief ? { brief: slot.brief } : {}),
            ...(slot.era === undefined ? {} : { era: slot.era }),
            ...(slot.mood === undefined ? {} : { mood: slot.mood }),
            broadcast: { mode: slot.mode, slotId },
            // Whatever the station is airing now, so the next show does not open on a record the last
            // one is about to play. What has already aired is the repeat window's business.
            avoidSongKeys: songKeysOf(lineup?.all() ?? []),
        });
        if (signal?.aborted) return;

        if (planned.tracks.length === 0) {
            // Nothing written, so the show opens and refills as it always did. Logged rather than put on
            // the feed: the refill at the boundary will say so if it comes back empty too.
            this.logger.info('schedule: prepared nothing for the next show', {
                slot: slotId,
                occurrence,
                named: planned.named,
                resolved: planned.resolved,
            });
            return;
        }

        await this.prepared.save(slotId, occurrence, planned.tracks);
        // The audio as well as the choice: the commit gate holds a record until its bytes are here, so a
        // set chosen early whose first record downloads at the boundary is still a silence.
        const fetching = await this.warm(planned.tracks);

        this.logger.info('schedule: prepared the next show', { slot: slotId, occurrence, records: planned.tracks.length, fetching });
        void this.activity.record({
            module: 'director',
            kind: 'schedule.prepared',
            detail: `The station chose the first ${planned.tracks.length} ${planned.tracks.length === 1 ? 'record' : 'records'} of ${named(slot.label)} before it starts.`,
            data: { slot: slotId, occurrence, records: planned.tracks.length },
        });
    }

    /**
     * Ask for the opening records' audio, and answer how many were asked for. Never throws: the set is
     * already saved, and a fetch that could not be asked for now is asked for at the boundary as
     * before.
     */
    private async warm(tracks: readonly RundownTrack[]): Promise<number> {
        try {
            return await this.cache.warm(tracks);
        } catch (error) {
            this.logger.warn(`schedule: could not fetch the opening of the next show ahead of time (${errorText(error)})`);
            return 0;
        }
    }
}

/**
 * How long before a slot starts it is prepared.
 *
 * Long enough for a model refill and a retry with room to spare (a refill takes a minute or two on the
 * live station), and short enough that what the station is airing now is still a fair guide to which
 * songs to keep out of the opening.
 */
export const PREPARE_AHEAD_MS = 10 * 60_000;

const named = (label: string): string => (label.trim().length > 0 ? `"${label.trim()}"` : 'the next show');
