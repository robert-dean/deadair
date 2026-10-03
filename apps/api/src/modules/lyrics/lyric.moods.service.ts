import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { LlmService } from '#modules/llm/llm.service.js';
import { SearchService } from '#modules/search/search.service.js';
import { errorText } from '#modules/shared/error.text.js';
import { LYRIC_MOODS_KEYS } from './lyrics.keys.js';
import { LyricLabelsRepository } from './lyric.labels.repository.js';
import { moodsPrompt, MOODS_VERSION, readMoods } from './lyric.moods.js';

/** Lowest, so a break writer or a refill always gets the model first. See `MODEL_PRIORITY` in fact extraction. */
export const MOODS_PRIORITY = 'background' as const;

/** How long to wait to get INTO the model slot before giving up for this pass. Nothing is waiting on a mood. */
export const MOODS_WAIT_MS = 5_000;

/** How long one judgement may hold the slot, searches included. */
export const MOODS_BUDGET_MS = 120_000;

/** At most this many searches before the model has to answer. Two is enough to find out what a song is about. */
export const MOODS_MAX_SEARCHES = 2;

/** First retry after a judgement failed, doubling from here up to a week. */
export const MOODS_FAILURE_RETRY_MS = 60 * 60 * 1000;
export const MOODS_FAILURE_MAX_RETRY_MS = 7 * 24 * 60 * 60 * 1000;

/** The one tool a mood judgement may call. Everything else the model can reach is about the station, not this record. */
const SEARCH_TOOL = 'search_web';

export interface MoodsPassSummary {
    /** Records given a distribution. */
    judged: number;
    /** Records the model looked at and could not place. Recorded, so they are not asked again until the instructions change. */
    unplaced: number;
    /** Records whose judgement failed and will be retried. */
    failed: number;
    /** The pass stopped because something with a deadline wanted the model. */
    yielded: boolean;
}

/**
 * Has the station's model judge what mood each record is in, from its lyric and, where the station
 * can search, from what the web says about it.
 *
 * The lyric goes INTO a prompt and only numbers come back, so nothing here can quote it. The search is
 * the only tool on offer (`onlyTools`): a judgement about one record has no business with the catalog,
 * the charts or the news. A prompt carrying a lyric is never captured, whatever `llm.captureWrites`
 * says, because a capture would be a second copy of somebody's copyrighted text; this calls the
 * conversation directly and writes nothing but the answer.
 */
@Injectable()
export class LyricMoodsService {
    constructor(
        private readonly labels: LyricLabelsRepository,
        private readonly llm: LlmService,
        private readonly search: SearchService,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    async labelPending(limit: number, signal?: AbortSignal, priority: readonly string[] = []): Promise<MoodsPassSummary> {
        const summary: MoodsPassSummary = { judged: 0, unplaced: 0, failed: 0, yielded: false };
        const searchable = this.search.hasSearch();
        const model = this.config.get(LYRIC_MOODS_KEYS.model, '').trim();

        const candidates = await this.labels.listTracksNeedingMoods(MOODS_VERSION, limit, searchable, priority);

        for (const candidate of candidates) {
            if (signal?.aborted) break;

            let answer;
            try {
                answer = await this.llm.converse(
                    { messages: moodsPrompt(candidate, searchable), ...(model.length === 0 ? {} : { model }), reasoningEffort: 'low' },
                    {
                        budgetMs: MOODS_BUDGET_MS,
                        maxWaitMs: MOODS_WAIT_MS,
                        priority: MOODS_PRIORITY,
                        ...(searchable ? { onlyTools: [SEARCH_TOOL], maxToolSteps: MOODS_MAX_SEARCHES } : { tools: false }),
                    },
                );
            } catch (error) {
                // The model could not be reached or was busy, which says nothing about the record: stop
                // the pass rather than marking a batch of records failed over the station's schedule.
                this.logger.info('lyric moods: the model was not available, so the pass stopped', { error: errorText(error) });
                summary.yielded = true;
                break;
            }

            if (answer.finishReason === 'preempted') {
                summary.yielded = true;
                break;
            }

            const moods = readMoods(answer.text);
            try {
                if (moods === undefined) {
                    summary.failed++;
                    await this.labels.recordMoodFailure(
                        candidate.trackId,
                        'the answer was not a mood distribution',
                        MOODS_FAILURE_RETRY_MS,
                        MOODS_FAILURE_MAX_RETRY_MS,
                    );
                } else if (moods === 'unknown') {
                    summary.unplaced++;
                    await this.labels.saveMoods(candidate.trackId, undefined, MOODS_VERSION);
                } else {
                    summary.judged++;
                    await this.labels.saveMoods(candidate.trackId, moods, MOODS_VERSION);
                }
            } catch (error) {
                this.logger.warn('lyric moods: could not store a judgement', { trackId: candidate.trackId, error: errorText(error) });
            }
        }

        return summary;
    }
}
