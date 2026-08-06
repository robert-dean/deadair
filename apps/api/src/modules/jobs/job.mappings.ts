import { JobNames } from '#src/modules/shared/job.names.js';
import { Constructor, Injectable } from 'injectkit';
import { Duration } from 'luxon';
import { Job } from '@maroonedsoftware/jobbroker';
import type { PgBossJobRegistration } from '@maroonedsoftware/jobbroker/pgboss';
import { CatalogPlaceholderJob } from '#modules/catalog/ingest/catalog.placeholder.job.js';
import { CatalogSyncJob } from '#modules/catalog/ingest/catalog.sync.job.js';
import { EnrichmentJob } from '#modules/enrichment/enrichment.job.js';

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

    // No cron: the sync sends this when it has actually grown the library, which
    // is the only event that can change any of these answers. A schedule would
    // re-read the same rows to the same conclusion all day.
    //
    // No dead-letter queue either, for the same reason. A batch that fails is
    // simply retried by the next sync that adds anything, and the rows it would
    // have resolved are still sitting there unresolved — the work is its own
    // record, so there is nothing a dead-letter row would preserve.
    'catalog.resolve_placeholders': {
        job: CatalogPlaceholderJob,
        policy: { retryLimit: 2, expiresIn: Duration.fromObject({ minutes: 10 }) },
    },

    // Every quarter hour, and also sent by the sync whenever it added tracks, so
    // a new arrival is described in minutes rather than waiting for a slow
    // sweep. The interval is small because the batch is: an enrichment source
    // paced at a request per second cannot be hurried, so throughput comes from
    // running often rather than from running long.
    //
    // One run walks tracks and then artists, because the artist pass matches on
    // an mbid the track pass promotes.
    //
    // One retry, no dead-letter queue. A track that failed still has no fresh
    // enrichment row, so it is still outstanding and the next pass picks it up —
    // the work is its own record, and there is nothing a dead-letter row would
    // preserve. `expiresIn` is comfortably above a full batch and below the
    // interval, so a wedged run is reclaimed before the next one starts.
    'catalog.enrich': {
        job: EnrichmentJob,
        cron: '*/15 * * * *',
        policy: { retryLimit: 1, expiresIn: Duration.fromObject({ minutes: 10 }) },
    },
};
