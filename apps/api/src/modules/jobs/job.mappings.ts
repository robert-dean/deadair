import { JobNames } from '#src/modules/shared/job.names.js';
import { Constructor, Injectable } from 'injectkit';
import { Duration } from 'luxon';
import { Job } from '@maroonedsoftware/jobbroker';
import type { PgBossJobRegistration } from '@maroonedsoftware/jobbroker/pgboss';
import { CatalogSyncJob } from '#modules/music/catalog.sync.job.js';

/**
 * What a job name maps to. The bare constructor is the short form for an
 * on-demand job with no policy; the object form is what anything real needs,
 * because a cron schedule and a retry/dead-letter policy are declared where the
 * job is mapped rather than per `send` (see {@link PgBossJobRegistration}).
 */
export type JobMapping = Constructor<Job> | PgBossJobRegistration;

/** The job class behind a mapping, in either form. */
export const jobClassOf = (mapping: JobMapping): Constructor<Job> => (typeof mapping === 'function' ? mapping : mapping.job) as Constructor<Job>;

@Injectable()
export class FakeJob implements Job {
    async run(): Promise<void> {
        console.log('FakeJob executed');
    }
}

export const JobMappings: Record<JobNames, JobMapping> = {
    fake: FakeJob,

    // Hourly. A provider's library changes on human timescales, and the walk
    // costs one rate-limited request per 50 items, so there is nothing to gain
    // from asking more often and a rate-limit ban to lose.
    //
    // The policy is sized for the failure this actually has: a flaky upstream.
    // Two retries with backoff outlast a blip; beyond that the next hourly run
    // is the retry, so nothing is lost by giving up and letting the dead-letter
    // queue keep the evidence. `expiresIn` is the ceiling on one walk, generous
    // enough for a large library and short enough that a wedged run is
    // reclaimed rather than blocking the queue until someone notices.
    'catalog.sync': {
        job: CatalogSyncJob,
        cron: '0 * * * *',
        policy: {
            retryLimit: 2,
            retryDelay: Duration.fromObject({ minutes: 1 }),
            retryBackoff: true,
            expiresIn: Duration.fromObject({ minutes: 30 }),
            deadLetter: 'catalog.sync.dead',
        },
    },
};
