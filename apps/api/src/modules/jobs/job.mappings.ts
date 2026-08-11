import { JobNames } from '#src/modules/shared/job.names.js';
import { Constructor, Injectable } from 'injectkit';
import { Duration } from 'luxon';
import { Job } from '@maroonedsoftware/jobbroker';
import type { PgBossJobRegistration } from '@maroonedsoftware/jobbroker/pgboss';
import { CatalogPlaceholderJob } from '#modules/catalog/ingest/catalog.placeholder.job.js';
import { CatalogSyncJob } from '#modules/catalog/ingest/catalog.sync.job.js';
import { EnrichmentJob } from '#modules/enrichment/enrichment.job.js';
import { ArtCacheJob } from '#modules/art/art.cache.job.js';
import { AnalysisJob } from '#modules/analysis/analysis.job.js';
import { ExtendLineupJob } from '#modules/director/extend.lineup.job.js';
import { WriteBreakJob } from '#modules/director/write.break.job.js';
import { RenderSegmentJob } from '#modules/render/render.segment.job.js';

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
    // sweep. Throughput comes from the batch filling the interval rather than
    // from running more often: an enrichment source paced at a request per
    // second cannot be hurried, and a second run inside the same window would
    // only queue behind the first on the same limiter.
    //
    // One run walks tracks, then artists, then albums, because the later passes
    // match on ids the track pass promotes.
    //
    // One retry, no dead-letter queue. A track that failed still has no fresh
    // enrichment row, so it is still outstanding and the next pass picks it up —
    // the work is its own record, and there is nothing a dead-letter row would
    // preserve. `expiresIn` sits above a full run and below the interval, so a
    // wedged run is reclaimed before the next one starts: the walk stops asking
    // for work at `RUN_BUDGET_MS` (11 minutes) and can overshoot by at most the
    // batch call already in flight, so thirteen clears it either way.
    'catalog.enrich': {
        job: EnrichmentJob,
        cron: '*/15 * * * *',
        policy: { retryLimit: 1, expiresIn: Duration.fromObject({ minutes: 13 }) },
    },

    // Every ten minutes, and also sent by the sync whenever it added tracks, so a new arrival's
    // cover is local rather than hotlinked within minutes. Its queue is the catalog's own
    // `image_url` columns, so it picks up art from ingest and from the enrichment walk alike
    // without either of them knowing it exists.
    //
    // One retry, no dead-letter queue, for the reason the enrichment pass gives: a URL that failed
    // still has no bytes, so it is still outstanding and the next pass picks it up under its own
    // backoff. The work is its own record. `expiresIn` sits above a full batch of timeouts and
    // below the interval, so a wedged run is reclaimed before the next one starts.
    'catalog.cache_art': {
        job: ArtCacheJob,
        cron: '*/10 * * * *',
        policy: { retryLimit: 1, expiresIn: Duration.fromObject({ minutes: 5 }) },
    },

    // Every half hour, which is far less often than the enrichment walk beside it,
    // and the difference is the point. Enrichment is paced by an upstream that
    // answers in about a second and cannot be hurried, so running often is how it
    // gets through a library. This is paced by a decode, and running it more often
    // would not measure more tracks — it would put a second walk on the same
    // analyzer, where the first is already using whatever `analysis.concurrency`
    // allows. Throughput here comes from that setting and the analyzer's own worker
    // count, never from the schedule.
    //
    // Deliberately NOT sent by the catalog sync the way enrichment is. A newly
    // arrived track wants describing within minutes because the station may talk
    // about it tonight; it does not want measuring within minutes, because an
    // unmeasured track plays perfectly well and a sync that added two thousand
    // tracks would otherwise queue two thousand decodes at once.
    //
    // One retry, no dead-letter queue, for the reason the enrichment pass gives: a
    // track that failed carries its own `failed_at`, so it is excluded for a day
    // and then rejoins the queue on its own. The work is its own record.
    // `expiresIn` sits above a full run and below the interval, so a wedged run is
    // reclaimed before the next one starts.
    'catalog.analyze': {
        job: AnalysisJob,
        cron: '*/30 * * * *',
        policy: { retryLimit: 1, expiresIn: Duration.fromObject({ minutes: 28 }) },
    },

    // No cron: the director sends this when a lineup it is airing runs short, which
    // is the only event that means anything here. A schedule would top up lineups
    // nobody is listening to and leave the one on air to the same trigger anyway.
    //
    // One retry and no dead-letter queue, for the reason the enrichment pass gives:
    // a lineup that failed to grow is still short, so the next boundary sends this
    // again under the director's own guard. The work is its own record. `expiresIn`
    // is short because there is nothing slow in a run today — a sample, two history
    // reads and one write — and a wedged run must be reclaimed well before the
    // lineup it was meant to refill actually drains.
    'director.extend_lineup': {
        job: ExtendLineupJob,
        policy: { retryLimit: 1, expiresIn: Duration.fromObject({ minutes: 3 }) },
    },

    // No cron: a break is written because the planner put one in a running order, and there is
    // nothing to find by walking. A segment left script-less by a run that never happened is
    // skipped by the director like any other segment that is not ready.
    //
    // One retry. The usual failure is a writer with nothing to say, which the job records on the row
    // rather than throwing, so the retry is only ever spent on a fault outside the writing itself.
    // `expiresIn` is short today, because the deterministic writer is a string built in memory, and
    // it is the one number here that a model binding will have to raise.
    'director.write_break': {
        job: WriteBreakJob,
        policy: { retryLimit: 1, expiresIn: Duration.fromObject({ minutes: 3 }) },
    },

    // No cron: a segment is rendered because something planned one, and walking
    // the table on a timer would re-attempt every segment whose engine is down
    // on every tick.
    //
    // One retry, because the usual failure is a TTS server that is not there and
    // the second attempt will find it just as absent — but the job does not
    // rethrow, so that retry is only ever spent on a fault outside the render
    // itself. `expiresIn` sits above a slow synthesis on CPU plus the draining
    // that follows it, and well below anything an operator would call stuck.
    'render.segment': {
        job: RenderSegmentJob,
        policy: { retryLimit: 1, expiresIn: Duration.fromObject({ minutes: 10 }) },
    },
};
