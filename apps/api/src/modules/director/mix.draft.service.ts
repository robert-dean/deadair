import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { httpError } from '@maroonedsoftware/errors';
import { Logger } from '@maroonedsoftware/logger';
import { LlmService } from '#modules/llm/llm.service.js';
import { modelList } from '#modules/llm/model.list.js';
import { mixFlowProblems } from '#modules/schedule/mix.flow.validate.js';
import type { MixFlowDraft, MixFlowDraftRequest } from '#modules/schedule/types/mix.types.js';
import { errorText } from '#modules/shared/error.text.js';
import { CandidatesRepository } from './candidates.repository.js';
import { buildMixDraft, mixDraftPrompt, readMixDraft } from './mix.draft.js';
import { MIX_FLOW_KEYS } from './mix.flow.keys.js';

/** How many of the library's main genres the model is told, commonest first. */
const GENRES_TOLD = 60;
const BUDGET_MS = 120_000;
/** An operator is waiting, so a draft queues behind the station only so long before it says so. */
const WAIT_MS = 30_000;
/** One more try when the answer cannot be read as rules: a local model's JSON slips now and then. */
const ATTEMPTS = 2;

/**
 * Drafts a show's mix flow from its brief, for the show editor (`POST /schedule/mix-draft`).
 *
 * The model reads the brief into rules (`mix.draft.ts` says why rules and not a graph), the station lays
 * them out as a flow, and the flow goes through `mixFlowProblems`, the check every saved flow passes.
 * Nothing is saved: the operator looks the draft over on the canvas and saves it with the show.
 *
 * At `preview` priority, on the rehearsal's argument: the station on air always comes first, and an
 * operator at the desk is the one caller who can be told so and try again.
 */
@Injectable()
export class MixDraftService {
    constructor(
        private readonly llm: LlmService,
        private readonly candidates: CandidatesRepository,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    async draft(request: MixFlowDraftRequest): Promise<MixFlowDraft> {
        const genres = await this.candidates.commonMainGenres(GENRES_TOLD);
        const messages = mixDraftPrompt(request.brief, genres, request.answers ?? []);
        const models = modelList(this.config, MIX_FLOW_KEYS.draftModel);
        const model = models[0] ?? '';

        for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
            let answer;
            try {
                answer = await this.llm.converse(
                    { messages, ...(model.length === 0 ? {} : { model }), reasoningEffort: 'medium' },
                    { models, budgetMs: BUDGET_MS, maxWaitMs: WAIT_MS, priority: 'preview', tools: false },
                );
            } catch (error) {
                this.logger.info('mix draft: the model was not available', { error: errorText(error) });
                throw httpError(503).withDetails({ message: 'The station’s model is not available to draft with. Try again in a moment.' });
            }
            if (answer.finishReason === 'preempted') {
                throw httpError(503).withDetails({ message: 'The model was needed on air, so the draft stopped. Try again in a moment.' });
            }

            const read = answer.finishReason === 'budget' ? undefined : readMixDraft(answer.text);
            if (read === undefined) {
                this.logger.info('mix draft: the answer could not be read as rules', { attempt, finishReason: answer.finishReason });
                continue;
            }

            const { flow, readings } = buildMixDraft(read);
            // The builder only makes flows that pass, so a problem here is the station's bug, not the model's.
            const problems = mixFlowProblems(flow);
            if (problems.length > 0) {
                this.logger.warn('mix draft: a drafted flow failed its own check', { problems });
                throw httpError(500).withDetails({ message: 'The drafted flow did not pass its own check.', problems });
            }

            this.logger.info('mix draft: drafted a flow from a brief', {
                nodes: flow.nodes.length,
                readings: readings.length,
                questions: readings.filter(reading => reading.question !== undefined).length,
                model: answer.model,
            });
            return { flow, readings: readings.slice(0, 40), model: answer.model };
        }

        throw httpError(502).withDetails({ message: 'The model’s answer could not be read as rules. Try again, or draw the flow by hand.' });
    }
}
