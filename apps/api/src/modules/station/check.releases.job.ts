import { Container, Injectable } from 'injectkit';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { PlainJob } from '#modules/jobs/plain.job.js';
import { ReleaseWatch } from './station.release.watch.js';

/**
 * The hourly nudge to the release watch, which decides for itself whether GitHub is due a question.
 *
 * A plain `Job`, because it touches no table, and a thin one, because everything worth testing is in
 * `ReleaseWatch`: which releases count, when to ask, and that no failure escapes.
 */
@Injectable()
export class CheckReleasesJob extends PlainJob {
    constructor(
        private readonly watch: ReleaseWatch,
        context: JobContext,
        container: Container,
        logger: Logger,
    ) {
        super(context, container, logger);
    }

    protected async execute(): Promise<void> {
        await this.watch.check();
    }
}
