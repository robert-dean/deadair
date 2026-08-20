import { Container, Injectable } from 'injectkit';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { PlainJob } from '#modules/jobs/plain.job.js';
import { withRunBudget } from '#modules/jobs/run.budget.js';
import { FactExtractionService } from './fact.extraction.service.js';
import { PronunciationMiningService } from './pronunciation.mining.service.js';

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
 * Documents the MODEL pass reads per run, which is a different order of number
 * entirely.
 *
 * One document here is two generations against one shared model slot, plus a
 * verification per claim it produced. On a self-hosted model that is minutes,
 * not milliseconds — so the batch is sized to what fits in the run budget
 * rather than to how many documents are waiting, and the backlog drains over
 * days. That is the intended shape: nothing is waiting on a fact, and the floor
 * has already said something about every one of these articles.
 */
const MODEL_BATCH_SIZE = 8;

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
        private readonly pronunciations: PronunciationMiningService,
        context: JobContext,
        container: Container,
        logger: Logger,
    ) {
        super(context, container, logger);
    }

    protected async execute(payload?: FactExtractionPayload, signal?: AbortSignal): Promise<void> {
        const limit = payload?.limit ?? BATCH_SIZE;

        const { result, outOfTime } = await withRunBudget(RUN_BUDGET_MS, signal, async stop => {
            // The floor first, and always. It needs no model, so it is done
            // before anything can be blocked, deferred or turned off — which is
            // what makes a station with no model plugin still fill its store.
            const lead = await this.extraction.extractLead(limit, stop);

            // The same documents read for a second thing entirely: the pronunciation key the
            // article printed for its own name. Batched with the floor rather than with the model,
            // because it is the same sort of work — local rows and arithmetic — and it is here
            // rather than in a job of its own because the documents, the budget and the marks are
            // all already walked exactly once by this one.
            const glosses = await this.pronunciations.mine(limit, stop);

            // Then whatever a model can add on top. Off by default, and every
            // way it declines leaves the passes above already banked.
            const model = await this.extraction.extractModel(MODEL_BATCH_SIZE, stop);

            return { lead, glosses, model };
        });

        // Quiet when there was nothing to do. On a settled station this is every
        // run: the documents stop arriving once the enrichment walk has been
        // over the catalog, and it stays quiet until a record is added.
        if (result.lead.read + result.glosses.read + result.model.read > 0) {
            this.logger.info('fact extraction pass', {
                job: this.context.id,
                lead: result.lead,
                glosses: result.glosses,
                model: result.model,
                outOfTime,
            });
        }
    }
}
