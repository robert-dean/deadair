import { Container, Injectable, ScopedContainer } from 'injectkit';
import { Job, JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { overrideJobActor } from '#modules/jobs/job.authorization.js';
import { ScriptHistoryRepository } from './script.history.repository.js';
import { resolveHistoryRetentionDays } from './script.history.settings.js';

/**
 * The nightly sweep over what the station wrote.
 *
 * One statement, and it is the only thing in the module that deletes anything. The window comes from
 * `render.scriptHistoryDays` and is read HERE, per run, rather than captured at construction: the
 * setting is live, the job outlives any one value of it, and an operator lowering the window expects
 * tonight's sweep to honour it rather than the one after a restart.
 *
 * A plain `Job` rather than a `TransactionalJob`: it is one delete, nobody is waiting on it, and
 * wrapping it would pin a runtime-pool connection for no atomicity worth having. Because it is not
 * transactional, the actor has to be installed here.
 *
 * Nothing about the station depends on this running. A sweep that never runs costs disk; a sweep
 * that runs when the operator meant to keep everything costs the only record of what was said, which
 * is why `0` is checked in the repository as well as read here.
 */
@Injectable()
export class PruneScriptHistoryJob implements Job {
    constructor(
        private readonly history: ScriptHistoryRepository,
        private readonly config: AppConfig,
        private readonly context: JobContext,
        // `Container` resolves to the container doing the resolving, which for a job is the runner's
        // per-execution scope. `ScopedContainer` is a type alias, not a token, so it can only be the
        // cast — same as AnalysisJob.
        private readonly container: Container,
        private readonly logger: Logger,
    ) {}

    async run(): Promise<void> {
        overrideJobActor(this.container as ScopedContainer, this.context);

        const days = resolveHistoryRetentionDays(this.config);
        if (days <= 0) {
            // Said at debug rather than info: on a station keeping everything this is every night,
            // and a nightly line saying nothing happened is how a log stops being read.
            this.logger.debug('render: keeping every script, so nothing was swept', { job: this.context.id });
            return;
        }

        const removed = await this.history.pruneOlderThanDays(days);

        // Quiet when there was nothing old enough, which is every night on a young station.
        if (removed > 0) this.logger.info('render: swept old scripts', { job: this.context.id, removed, days });
    }
}
