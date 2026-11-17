import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { hasMixFlow } from '#modules/schedule/mix.flow.shape.js';
import { ScheduleService } from '#modules/schedule/schedule.service.js';
import type { MixFlow } from '#modules/schedule/types/mix.types.js';
import { errorText } from '#modules/shared/error.text.js';
import { CandidatesRepository } from './candidates.repository.js';
import { readClock } from './clock.bands.js';
import { stationZone } from './clock.words.js';
import { judgeQuestions, type MixInForce } from './mix.flow.js';
import { MixJudgeRepository } from './mix.judge.repository.js';
import { buildMixContext } from './mix.flow.context.js';
import { PlayHistoryRepository } from './play.history.repository.js';
import { minutesIntoSlot, minutesLeftInSlot } from './schedule.js';
import { isTrackItem, type StationLineupItem } from './station.lineup.js';

/** What a refill knows about the order it is for, as far as the flow is concerned. */
export interface MixLineup {
    broadcastId: string;
    slotId?: string;
    rules: { mixFlow?: MixFlow };
}

export interface MixReaders {
    history: Pick<PlayHistoryRepository, 'countedDuringBroadcast'>;
    candidates: Pick<CandidatesRepository, 'mainGenresFor'>;
    judgements: Pick<MixJudgeRepository, 'answersFor'>;
    schedule: Pick<ScheduleService, 'inForce'>;
    config: AppConfig;
    logger: Logger;
}

/**
 * The show's mix flow with its counts so far, for a refill or a replan of `lineup`, or nothing when the
 * show has no flow.
 *
 * `ahead` is what will stay in the order in front of the batch, in airing order: requests and their
 * follow-ons are left out of it here, so they are never counted. The show's window is the slot in
 * force when it is this broadcast's slot, which is what `showProgress` and a `require` node's percent
 * are measured against; a broadcast put on by hand has no window and reads as its start.
 *
 * A read that fails costs this batch its flow and never the batch: the station plays as it would
 * without one, says so, and the next refill tries again.
 */
export async function readMixInForce(
    lineup: MixLineup,
    ahead: readonly StationLineupItem[],
    readers: MixReaders,
    now = Date.now(),
): Promise<MixInForce | undefined> {
    const flow = lineup.rules.mixFlow;
    if (!hasMixFlow(flow)) return undefined;
    try {
        const zone = stationZone(readers.config);
        const queued = ahead.filter(isTrackItem).filter(item => item.requestId === undefined && item.followsRequestId === undefined);
        const [aired, slot] = await Promise.all([
            readers.history.countedDuringBroadcast(lineup.broadcastId),
            lineup.slotId === undefined ? Promise.resolve(undefined) : readers.schedule.inForce(new Date(now)).catch(() => undefined),
        ]);
        const queuedRecords = queued.map(item => ({
            title: item.track.title,
            artist: item.track.artist,
            ...(item.track.trackId === undefined ? {} : { trackId: item.track.trackId }),
        }));
        const trackIds = [...aired, ...queuedRecords].flatMap(record => (record.trackId === undefined ? [] : [record.trackId]));
        const unique = [...new Set(trackIds)];
        const questions = judgeQuestions(flow).map(question => question.key);
        const [genres, judged] = await Promise.all([
            readers.candidates.mainGenresFor(unique),
            questions.length === 0 ? Promise.resolve(new Map<string, Map<string, boolean>>()) : readers.judgements.answersFor(unique, questions),
        ]);
        const show =
            slot !== undefined && slot.id === lineup.slotId
                ? { startMs: now - minutesIntoSlot(slot, now, zone) * 60_000, endMs: now + minutesLeftInSlot(slot, now, zone) * 60_000 }
                : undefined;
        return {
            flow,
            ctx: buildMixContext({
                flow,
                aired,
                queued: queuedRecords,
                genres,
                judged,
                hourOf: ms => readClock(ms, zone).hour,
                nowMs: now,
                ...(show === undefined ? {} : { show }),
            }),
        };
    } catch (error) {
        readers.logger.warn("director: could not read the show's mix flow counts; this batch plays without its flow", { error: errorText(error) });
        return undefined;
    }
}

/**
 * {@link readMixInForce} as a scoped service, so a job that plans takes one dependency for the flow
 * rather than the four reads behind it.
 */
@Injectable()
export class MixFlowReader {
    constructor(
        private readonly history: PlayHistoryRepository,
        private readonly candidates: CandidatesRepository,
        private readonly judgements: MixJudgeRepository,
        private readonly schedule: ScheduleService,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    async read(lineup: MixLineup, ahead: readonly StationLineupItem[]): Promise<MixInForce | undefined> {
        return await readMixInForce(lineup, ahead, {
            history: this.history,
            candidates: this.candidates,
            judgements: this.judgements,
            schedule: this.schedule,
            config: this.config,
            logger: this.logger,
        });
    }
}
