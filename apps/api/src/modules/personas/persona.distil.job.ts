import { Container, Injectable } from 'injectkit';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { PlainJob } from '#modules/jobs/plain.job.js';
import { withRunBudget } from '#modules/jobs/run.budget.js';
import { PersonaDistilService } from './persona.distil.service.js';

/**
 * How long a run may keep reading before it stops.
 *
 * Sized for a station with a full roster: nineteen characters at two generations each against one
 * self-hosted model slot is minutes rather than seconds. Whatever is left is picked up tomorrow —
 * each character moves its own watermark, so stopping is always legal and never loses a window
 * already read.
 */
export const RUN_BUDGET_MS = 10 * 60 * 1000;

/**
 * The nightly pass that reads each character's own breaks back to it.
 *
 * A plain `Job` rather than a `TransactionalJob`, following `FactExtractionJob`: this is a walk over
 * several characters and each settles on its own, so wrapping the pass would hold one snapshot open
 * for its whole length and undo every character read before a failure on the last.
 *
 * **It must run before `render.prune_script_history`**, which is the one scheduling fact here that is
 * not a preference: the sweep deletes the material this reads, so a pass ordered after it on a
 * station with a short retention would find a window that had already been thrown away. See the
 * crons in `job.mappings.ts`, which state both times.
 */
@Injectable()
export class PersonaDistilJob extends PlainJob {
    constructor(
        private readonly distil: PersonaDistilService,
        context: JobContext,
        container: Container,
        logger: Logger,
    ) {
        super(context, container, logger);
    }

    protected async execute(_payload?: object, signal?: AbortSignal): Promise<void> {
        const { result, outOfTime } = await withRunBudget(RUN_BUDGET_MS, signal, async stop => await this.distil.run(stop));

        // Quiet when there was nothing to do, which is every run on a station with the setting off,
        // no model, or nothing new said since yesterday. A line per night saying "read nothing" is a
        // log nobody reads.
        if (result.read > 0 || result.failed > 0) {
            this.logger.info('persona notes pass', { job: this.context.id, ...result, outOfTime });
        }
    }
}
