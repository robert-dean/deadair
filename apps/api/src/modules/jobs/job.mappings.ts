import { JobNames } from '#src/modules/shared/job.names.js';
import { Constructor, Injectable } from 'injectkit';
import { Duration } from 'luxon';
import { Job } from '@maroonedsoftware/jobbroker';
import type { PgBossJobRegistration } from '@maroonedsoftware/jobbroker/pgboss';
import { CatalogPlaceholderJob } from '#modules/catalog/ingest/catalog.placeholder.job.js';
import { CatalogSyncJob } from '#modules/catalog/ingest/catalog.sync.job.js';
import { EnrichmentJob } from '#modules/enrichment/enrichment.job.js';
import { FactExtractionJob } from '#modules/enrichment/fact.extraction.job.js';
import { ArtCacheJob } from '#modules/art/art.cache.job.js';
import { AnalysisJob } from '#modules/analysis/analysis.job.js';
import { CacheTrackJob } from '#modules/playout/audio/cache.track.job.js';
import { ExtendLineupJob } from '#modules/director/extend.lineup.job.js';
import { ReplanLineupJob } from '#modules/director/replan.lineup.job.js';
import { WriteBreakJob } from '#modules/director/write.break.job.js';
import { RenderSegmentJob } from '#modules/render/render.segment.job.js';
import { PruneScriptHistoryJob } from '#modules/render/prune.script.history.job.js';
import { PruneActivityJob } from '#modules/activity/prune.activity.job.js';
import { ScrobbleFlushJob } from '#modules/scrobble/scrobble.flush.job.js';

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

    // Every quarter hour, offset from the walk above so it reads what that one
    // has just stored rather than racing it. The offset is the only relationship
    // between them: a document read a quarter of an hour late costs nothing,
    // because nothing is waiting on a fact.
    //
    // Its queue is documents with no extraction row, which is why it needs no
    // trigger from the walk the way `catalog.cache_art` does — an article that
    // arrived a minute ago is simply outstanding, exactly like one that arrived
    // last week.
    //
    // One retry, no dead-letter queue, for the reason every walk here gives: a
    // document that failed keeps no mark, so it is still outstanding and the
    // next pass picks it up. `expiresIn` sits above a full run
    // (`RUN_BUDGET_MS`, 4 minutes) and below the interval, so a wedged run is
    // reclaimed before the next one starts.
    'catalog.extract_facts': {
        job: FactExtractionJob,
        cron: '7-59/15 * * * *',
        policy: { retryLimit: 1, expiresIn: Duration.fromObject({ minutes: 6 }) },
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

    // Hourly, and a batch of five, and a minute between tracks. All three are the
    // same precaution rather than three separate ones.
    //
    // **Measuring a track is a full audio download through the provider credential
    // the station plays on.** At */30 with a batch of 50 that is a hundred full
    // tracks an hour of background traffic against a station playing about fifteen,
    // which is six times the foreground load for work nobody is waiting on.
    //
    // So the schedule is not tuned for throughput here, unlike every other walk in
    // this file. It is tuned to stay underneath whatever headroom the station is
    // not using. A library gets measured over days, which is the right trade: an
    // unmeasured track plays perfectly well, and a station that cannot fetch audio
    // plays nothing at all. Raising any of the three without knowing the provider's
    // limits is how this regresses. See `BATCH_SIZE` in `analysis.job.ts` for what
    // this was mistakenly blamed for, so nobody re-investigates it.
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
        cron: '7 * * * *',
        policy: { retryLimit: 1, expiresIn: Duration.fromObject({ minutes: 50 }) },
    },

    // No cron: a record is worth a local copy because the station played it, so the
    // resolver sends this on a miss and there is nothing to find by walking. A
    // schedule would download the parts of the catalogue that never air, which is
    // the fill shape that was deliberately not chosen.
    //
    // ONE retry, and it is nearly free: the job does not rethrow, so the retry is
    // only ever spent on a fault outside the fetch itself, and the real retry is the
    // next play of the same record. No dead-letter queue for the same reason — the
    // row carries `last_error` and `next_attempt_at`, so the work is its own record.
    //
    // `expiresIn` sits above the fetch timeout plus the claim it holds, so a wedged
    // run is reclaimed rather than blocking the queue, and well below anything an
    // operator would call stuck.
    'playout.cache_track': {
        job: CacheTrackJob,
        policy: { retryLimit: 1, expiresIn: Duration.fromObject({ minutes: 15 }) },
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

    // No cron, and there could not be one: this is an operator saying they do not like what is
    // coming. Nothing about a running order makes a replan due.
    //
    // One retry, like the refill, and it is genuinely safe to take: the job changes nothing until
    // it posts, so an attempt that failed left the old tail exactly where it was. `expiresIn` is
    // longer than the refill's because a replan is the one that waits on a model before it does
    // anything, and a run reclaimed halfway is a run whose generation is thrown away.
    'director.replan_lineup': {
        job: ReplanLineupJob,
        policy: { retryLimit: 1, expiresIn: Duration.fromObject({ minutes: 10 }) },
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

    // Nightly, in the small hours, because it is housekeeping over a table nothing reads to make a
    // decision. It is one delete against an indexed timestamp, so the hour is chosen to stay out of
    // the way rather than because the work is heavy.
    //
    // NO retry, unlike everything else here, and the reason is which way the failure falls: a sweep
    // that did not run leaves rows that will be swept tomorrow, and the only thing a retry can buy
    // is a second chance to delete something. Nothing is waiting on it and nothing degrades without
    // it, so the cron IS the retry.
    'render.prune_script_history': {
        job: PruneScriptHistoryJob,
        cron: '23 4 * * *',
        policy: { retryLimit: 0, expiresIn: Duration.fromObject({ minutes: 10 }) },
    },

    // The same sweep over a different table, and everything above about the retry applies
    // unchanged. Half an hour later rather than at the same minute: the two are independent, and
    // two deletes racing each other at 04:23 for no reason is the kind of thing that is only ever
    // noticed as a mysterious spike.
    'activity.prune_events': {
        job: PruneActivityJob,
        cron: '53 4 * * *',
        policy: { retryLimit: 0, expiresIn: Duration.fromObject({ minutes: 10 }) },
    },

    // Every two minutes, which is a latency choice rather than a throughput one: a scrobble is a
    // record of something that already happened, and nobody is waiting on it. Frequent enough that
    // an evening's listening appears on the service while the operator is still listening, rare
    // enough that a station airing fifteen records an hour is not making a request per record.
    //
    // NO retry, like the two prune jobs above and for the same reason read from the other side: a
    // run that failed leaves every row where it was with its own backoff, so the cron IS the retry.
    // A job-level retry would put a second schedule on top of the row-level one and make the
    // backoff mean less than it says.
    //
    // `expiresIn` sits above a full run (`RUN_BUDGET_MS`) plus the batch that could be in flight
    // when it ends, and below the interval, so a wedged run is reclaimed before the next one starts.
    'scrobble.flush': {
        job: ScrobbleFlushJob,
        cron: '*/2 * * * *',
        policy: { retryLimit: 0, expiresIn: Duration.fromObject({ minutes: 5 }) },
    },
};
