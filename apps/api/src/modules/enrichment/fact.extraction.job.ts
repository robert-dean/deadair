import { Container, Injectable } from 'injectkit';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { PlainJob } from '#modules/jobs/plain.job.js';
import { withRunBudget } from '#modules/jobs/run.budget.js';
import { FactExtractionService } from './fact.extraction.service.js';

/**
 * Documents read per run — a ceiling, not a target.
 *
 * Much larger than the enrichment walk's batch, because the two are bounded by
 * different things. That one spends a rate-limited network request per item and
 * is paced by an upstream; this one reads rows that are already local and does
 * arithmetic on them. What stops it is {@link RUN_BUDGET_MS}.
 */
const BATCH_SIZE = 500;

/**
 * How long a run may keep reading before it stops.
 *
 * Comfortably inside the cron interval and inside the job's `expiresIn`.
 * Whatever is left is picked up by the next run, and there is always a next
 * run: each document is marked as read in its own transaction, so stopping is
 * always legal and never loses work already done.
 */
export const RUN_BUDGET_MS = 4 * 60 * 1000;

export interface FactExtractionPayload {
    /** Overrides {@link BATCH_SIZE} for one run. Absent, as it always is from cron, means the default. */
    limit?: number;
}

/**
 * The scheduled pass that turns stored articles into claims.
 *
 * A plain `Job` rather than a `TransactionalJob`, following `EnrichmentJob`:
 * this is a walk over many documents and each one settles on its own, so
 * wrapping the pass would hold one snapshot open for its whole length and undo
 * every document read before a failure on the last one.
 */
@Injectable()
export class FactExtractionJob extends PlainJob<FactExtractionPayload> {
    constructor(
        private readonly extraction: FactExtractionService,
        context: JobContext,
        container: Container,
        logger: Logger,
    ) {
        super(context, container, logger);
    }

    protected async execute(payload?: FactExtractionPayload, signal?: AbortSignal): Promise<void> {
        const limit = payload?.limit ?? BATCH_SIZE;

        const { result, outOfTime } = await withRunBudget(RUN_BUDGET_MS, signal, async stop => await this.extraction.extractLead(limit, stop));

        // Quiet when there was nothing to do. On a settled station this is every
        // run: the documents stop arriving once the enrichment walk has been
        // over the catalog, and it stays quiet until a record is added.
        if (result.read > 0) {
            this.logger.info('fact extraction pass', { job: this.context.id, ...result, outOfTime });
        }
    }
}
