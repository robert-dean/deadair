import { Container, Injectable } from 'injectkit';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { PlainJob } from '#modules/jobs/plain.job.js';
import { withRunBudget } from '#modules/jobs/run.budget.js';
import { MixJudgeService } from './mix.judge.service.js';

/** Questions answered per run at most. */
const BATCH_SIZE = 30;

/** Inside the cron interval and the job's `expiresIn`. */
export const MIX_JUDGE_RUN_BUDGET_MS = 4 * 60 * 1000;

export interface MixJudgePayload {
    limit?: number;
}

/**
 * Answers what the picker left pending for a show's judge split. Every five minutes, because a record
 * waits a refill for its answer and a refill is about an hour of programming. A pass with nothing
 * pending is one query.
 */
@Injectable()
export class MixJudgeJob extends PlainJob<MixJudgePayload> {
    constructor(
        private readonly judge: MixJudgeService,
        context: JobContext,
        container: Container,
        logger: Logger,
    ) {
        super(context, container, logger);
    }

    protected async execute(payload?: MixJudgePayload, signal?: AbortSignal): Promise<void> {
        const { result, outOfTime } = await withRunBudget(MIX_JUDGE_RUN_BUDGET_MS, signal, async stop =>
            this.judge.answerPending(payload?.limit ?? BATCH_SIZE, stop),
        );
        if (result.answered + result.failed > 0 || result.yielded) this.logger.info('mix judge pass', { job: this.context.id, ...result, outOfTime });
    }
}
