import { Container, Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { TransactionalJob } from '#modules/jobs/transactional.job.js';
import { CatalogPlaceholderService } from './catalog.placeholder.service.js';

/**
 * Retries unresolved playlist placeholders against the library.
 *
 * A `TransactionalJob`, unlike its sibling `CatalogSyncJob`: one bounded batch
 * of database work with no network in it, which is precisely the case that base
 * class is for. The batch settles all or nothing, and the audit GUCs and job
 * actor come with it.
 *
 * Sent by the catalog sync whenever a run added to the library, and safe to run
 * at any other time — it only ever reads more of the same rows.
 */
@Injectable({ deps: [Container] })
export class CatalogPlaceholderJob extends TransactionalJob {
    /**
     * Collaborators are resolved here rather than injected, as
     * {@link TransactionalJob} requires: the runner constructs the job before
     * `run`, so anything taken in the constructor would be built against the
     * pooled `Kysely` and quietly do its work outside this transaction.
     */
    protected async execute(_payload: object, signal?: AbortSignal): Promise<void> {
        const summary = await this.container.get(CatalogPlaceholderService).resolvePending(signal);
        this.container.get(Logger).info('placeholder pass', { job: this.container.get(JobContext).id, ...summary });
    }
}
