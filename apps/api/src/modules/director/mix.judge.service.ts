import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { LlmService } from '#modules/llm/llm.service.js';
import { modelList } from '#modules/llm/model.list.js';
import { SEARCH_WEB_TOOL } from '#modules/llm/websearch.tool.js';
import { SearchService } from '#modules/search/search.service.js';
import { errorText } from '#modules/shared/error.text.js';
import { MIX_FLOW_KEYS } from './mix.flow.keys.js';
import { MIX_JUDGE_VERSION, mixJudgePrompt, readMixJudgement } from './mix.judge.js';
import { MixJudgeRepository } from './mix.judge.repository.js';

const PRIORITY = 'background' as const;
const WAIT_MS = 5_000;
const BUDGET_MS = 90_000;
const MAX_SEARCHES = 2;
const FAILURE_RETRY_MS = 30 * 60 * 1000;
const FAILURE_MAX_RETRY_MS = 2 * 24 * 60 * 60 * 1000;

export interface JudgePassSummary {
    answered: number;
    failed: number;
    yielded: boolean;
}

/**
 * Answers the questions mix flows have asked about records and the picker has left pending, one at a
 * time at background priority: the mood walk's shape. No switch of its own, because nothing is pending
 * unless a show's operator drew a judge split, which is the asking.
 */
@Injectable()
export class MixJudgeService {
    constructor(
        private readonly judgements: MixJudgeRepository,
        private readonly llm: LlmService,
        private readonly search: SearchService,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    async answerPending(limit: number, signal?: AbortSignal): Promise<JudgePassSummary> {
        const summary: JudgePassSummary = { answered: 0, failed: 0, yielded: false };
        const searchable = this.search.hasSearch();
        const models = modelList(this.config, MIX_FLOW_KEYS.judgeModel);
        const model = models[0] ?? '';

        for (const pending of await this.judgements.pending(limit)) {
            if (signal?.aborted) break;
            let answer;
            try {
                answer = await this.llm.converse(
                    { messages: mixJudgePrompt(pending, searchable), ...(model.length === 0 ? {} : { model }), reasoningEffort: 'low' },
                    {
                        models,
                        budgetMs: BUDGET_MS,
                        maxWaitMs: WAIT_MS,
                        priority: PRIORITY,
                        ...(searchable ? { onlyTools: [SEARCH_WEB_TOOL], maxToolSteps: MAX_SEARCHES } : { tools: false }),
                    },
                );
            } catch (error) {
                this.logger.info('mix judge: the model was not available, so the pass stopped', { error: errorText(error) });
                summary.yielded = true;
                break;
            }
            if (answer.finishReason === 'preempted') {
                summary.yielded = true;
                break;
            }

            const judged = answer.finishReason === 'budget' ? undefined : readMixJudgement(answer.text);
            try {
                if (judged === undefined) {
                    summary.failed++;
                    const why = answer.finishReason === 'budget' ? 'the model ran out of time' : 'the answer was not yes or no';
                    await this.judgements.recordFailure(pending.questionKey, pending.trackId, why, FAILURE_RETRY_MS, FAILURE_MAX_RETRY_MS);
                } else {
                    summary.answered++;
                    await this.judgements.answer(pending.questionKey, pending.trackId, judged === true, MIX_JUDGE_VERSION);
                }
            } catch (error) {
                this.logger.warn('mix judge: could not store an answer', { trackId: pending.trackId, error: errorText(error) });
            }
        }
        return summary;
    }
}
