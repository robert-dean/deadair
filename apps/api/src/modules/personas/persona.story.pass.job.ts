import { Container, Injectable } from 'injectkit';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { PlainJob } from '#modules/jobs/plain.job.js';
import { withRunBudget } from '#modules/jobs/run.budget.js';
import { PersonaStoryPassService } from './persona.story.pass.service.js';

/**
 * How long a run may keep going before it stops.
 *
 * `PersonaDistilJob`'s value and its reason: a full roster against one self-hosted model slot is
 * minutes rather than seconds. Whatever is left is picked up tomorrow, and stopping loses nothing at
 * all here — unlike the distil pass, there is no watermark to be half-advanced, because a character
 * that was not reached simply has not been asked yet.
 */
export const RUN_BUDGET_MS = 10 * 60 * 1000;

/**
 * The nightly pass that gives each character something else to have lived through.
 *
 * A plain `Job` rather than a `TransactionalJob`, following `PersonaDistilJob`: this is a walk over
 * several characters, each settles on its own, and wrapping the pass would hold one snapshot open for
 * its whole length and undo every character written before a failure on the last.
 *
 * **It has no ordering constraint against the sweeps**, which is the one thing about its schedule
 * that differs from the pass beside it. The distil pass must run before `render.prune_script_history`
 * because it reads the material that sweep deletes; this one reads the station's own library through
 * its tools, and nothing deletes that overnight. So the hour is chosen to stay out of the way, and
 * to leave the model slot free for the pass that does have a deadline.
 */
@Injectable()
export class PersonaStoryPassJob extends PlainJob {
    constructor(
        private readonly stories: PersonaStoryPassService,
        context: JobContext,
        container: Container,
        logger: Logger,
    ) {
        super(context, container, logger);
    }

    protected async execute(_payload?: object, signal?: AbortSignal): Promise<void> {
        const { result, outOfTime } = await withRunBudget(RUN_BUDGET_MS, signal, async stop => await this.stories.run(stop));

        // Quiet when there was nothing to do, which is every run on a station with the setting off,
        // no model, or a roster whose characters the model had nothing to add to. A line per night
        // saying "thought of nothing" is a log nobody reads.
        if (result.stories > 0 || result.details > 0 || result.failed > 0) {
            this.logger.info('persona stories pass', { job: this.context.id, ...result, outOfTime });
        }
    }
}
