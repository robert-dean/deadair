import { Container, Injectable } from 'injectkit';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { PlainJob } from '#modules/jobs/plain.job.js';
import { withRunBudget } from '#modules/jobs/run.budget.js';
import { SimilarityFill } from './similarity.fill.js';

/**
 * Artists taken per run at most: a ceiling, as `EnrichmentJob`'s batch is, with the clock below
 * doing the stopping. Each artist is one call per similarity source, the slowest of them on a
 * one-request-a-second limiter, so a run gets through a few hundred.
 */
const BATCH_SIZE = 400;

/** Inside the cron interval and the job's `expiresIn`, as every walk's is. */
export const SIMILARITY_FILL_RUN_BUDGET_MS = 11 * 60 * 1000;

export interface SimilarityFillPayload {
    limit?: number;
}

/**
 * The library's similarity fill, a quarter hour at a time. See {@link SimilarityFill}.
 *
 * A plain job for the reason the enrichment walk is one: rate-limited network in the middle of a
 * long walk, each artist settling on its own.
 */
@Injectable()
export class SimilarityFillJob extends PlainJob<SimilarityFillPayload> {
    constructor(
        private readonly fill: SimilarityFill,
        context: JobContext,
        container: Container,
        logger: Logger,
    ) {
        super(context, container, logger);
    }

    protected async execute(payload?: SimilarityFillPayload, signal?: AbortSignal): Promise<void> {
        const { result, outOfTime } = await withRunBudget(SIMILARITY_FILL_RUN_BUDGET_MS, signal, async stop =>
            this.fill.fillPending(payload?.limit ?? BATCH_SIZE, stop),
        );

        // Quiet once the library is filled, which is every run after the first few.
        if (result.scanned > 0) this.logger.info('similarity fill pass', { job: this.context.id, ...result, outOfTime });
    }
}
