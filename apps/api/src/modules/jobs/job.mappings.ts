import { JobNames } from '#src/modules/shared/job.names.js';
import { Constructor } from 'injectkit';
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
import { FETCH_PER_PASS } from '#modules/playout/audio/track.cache.planner.js';
import { AirChartJob } from '#modules/director/air.chart.job.js';
import { ExtendLineupJob } from '#modules/director/extend.lineup.job.js';
import { ReplanLineupJob } from '#modules/director/replan.lineup.job.js';
import { ProduceProductionJob } from '#modules/productions/produce.production.job.js';
import { StitchProductionJob } from '#modules/productions/stitch.production.job.js';
import { ScheduleTickJob } from '#modules/schedule/schedule.tick.job.js';
import { WriteBreakJob } from '#modules/director/write.break.job.js';
import { RenderSegmentJob } from '#modules/render/render.segment.job.js';
import { PruneScriptHistoryJob } from '#modules/render/prune.script.history.job.js';
import { PersonaAuditionJob } from '#modules/personas/persona.audition.job.js';
import { PersonaDistilJob } from '#modules/personas/persona.distil.job.js';
import { PersonaStoryPassJob } from '#modules/personas/persona.story.pass.job.js';
import { PruneActivityJob } from '#modules/activity/prune.activity.job.js';
import { SweepTrackCacheJob } from '#modules/playout/audio/sweep.track.cache.job.js';
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

export const JobMappings: Record<JobNames, JobMapping> = {
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
    //
    // The ONE worker policy in this file, and it is a correction rather than a tuning. The ripener
    // sends `FETCH_PER_PASS` records per pass and has always described that as two downloads at a
    // time; a queue consumes one job at a time unless told otherwise, so the second fetch actually
    // began when the first one ended and a cold running order filled at half the intended rate —
    // which is the thing the constant was raised from one to escape. Matching the two numbers is
    // what makes the comment true, and reading the constant rather than restating it is what keeps
    // them from drifting apart again.
    //
    // It is safe to widen exactly here and nowhere else in this file. `TrackAudioService`
    // de-duplicates by source id in memory, so a wider queue cannot start a second download of the
    // same record, and the ceiling stays the ripener's own per-pass cap rather than becoming a new
    // one. The queues either side of it are the opposite case: `render.segment` and
    // `director.write_break` serialize on `SpeechGate` and `LlmGate`, so a second worker there would
    // hold a claimed job against its `expiresIn` while waiting for a resource it cannot have.
    'playout.cache_track': {
        job: CacheTrackJob,
        policy: { retryLimit: 1, expiresIn: Duration.fromObject({ minutes: 15 }) },
        worker: { concurrency: FETCH_PER_PASS },
    },

    // The other end of the job above: what the station keeps, bounded. Every fifteen
    // minutes, on a minute nothing else uses, because the cache grows only when a
    // record is fetched — a few an hour on an airing station — so this bounds the
    // overshoot at a few records' worth of bytes. Rarer lets a discovery burst run
    // away between passes; denser polls a number that has usually not moved.
    //
    // A CRON here is not the "evicting on a schedule" that `track-cache-eviction.md`
    // refuses. That argues against evicting on AGE. The cap is the trigger and age is
    // only the order, so an under-cap run reads one aggregate and stops, and a station
    // with no cap set does not get that far.
    //
    // NO retry, like the two prune jobs below and for the same reason: a sweep that
    // did not run leaves a cache that will be swept in fifteen minutes and nothing is
    // waiting on it, so the cron IS the retry. `expiresIn` sits above a full run —
    // several rounds of a batched delete plus the unlinks — and below the interval.
    'playout.sweep_track_cache': {
        job: SweepTrackCacheJob,
        cron: '3-59/15 * * * *',
        policy: { retryLimit: 0, expiresIn: Duration.fromObject({ minutes: 10 }) },
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

    // No cron, for the reason the replan gives: this is an operator choosing a document to air.
    //
    // NO retry, which is where it parts company with the other two. They are additive or replace a
    // tail; this ends the broadcast that is on and starts another, so a second attempt minutes later
    // would change a station the operator has since put somewhere else on the strength of a press
    // they have forgotten making. A chart that failed to air is a button to press again.
    //
    // `expiresIn` is the longest here and has to be: a chart is up to `MAX_CHART_ENTRIES` records
    // and the operator's path now asks for a lookup PER entry, each a search across every searchable
    // provider, with an ingest behind every hit.
    'director.air_chart': {
        job: AirChartJob,
        policy: { retryLimit: 0, expiresIn: Duration.fromObject({ minutes: 15 }) },
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

    // No cron: a pass runs because the pass before it finished, or because something commissioned a
    // production. Walking the table on a timer would re-attempt every production whose model is down
    // on every tick.
    //
    // NO retry, which is the one policy here that differs from its neighbours, and the row is why: a
    // pass that threw has already recorded the reason on the production and moved it to `failed`, so
    // a retry finds a settled row, claims nothing and does nothing. Worse, a pass that got half way
    // through drafting and then threw would, on a retry, re-claim and write its beats a second time.
    // Resuming is a decision an operator makes against a row they can see, not something a broker
    // does silently.
    //
    // `expiresIn` covers the longest pass: drafting is one model call per beat, sequentially, on a
    // host that is slow by design. Generous rather than tight, because the cost of a run being
    // reclaimed underneath a production that was nearly finished is the whole production.
    'director.produce': {
        job: ProduceProductionJob,
        policy: { retryLimit: 0, expiresIn: Duration.fromObject({ hours: 2 }) },
    },

    // No cron: a production is joined because the director noticed its last beat was spoken, and
    // walking the table on a timer would re-attempt a join whose analyzer is down on every tick.
    //
    // NO retry, for `director.produce`'s reason one entry up: the row is the checkpoint. A run that
    // failed has already left the production `ready` with no joined row, which is the state that
    // airs it as beats — so a retry would find nothing in `stitching` to claim and do nothing.
    // `expiresIn` sits above a decode of every beat of a feature-length programme, and well below
    // anything an operator would call stuck.
    'render.stitch_production': {
        job: StitchProductionJob,
        policy: { retryLimit: 0, expiresIn: Duration.fromObject({ minutes: 15 }) },
    },

    // EVERY MINUTE, and it must not be made coarser. A station zone can sit at a :30 or :45 offset
    // from this host's, so an hourly tick would land in the middle of every slot on the station's
    // clock rather than at its edges. A minute covers every minute of both clocks.
    //
    // Cheap enough to run that often: one small query and, on all but a handful of runs a day, a
    // comparison of two ids that matches and returns. The changeover itself is the only run that
    // reads a playlist.
    //
    // NO retry, and nothing is lost by that. The resolver is a pure function of the instant, so the
    // run a minute later asks the same question and acts on the same answer — the cron IS the retry,
    // and a retry a few seconds behind a failed changeover would only race the next tick. `expiresIn`
    // sits above a slow provider read, because a wedged run holding the queue is worse than a slot
    // that arrives late.
    'schedule.tick': {
        job: ScheduleTickJob,
        cron: '* * * * *',
        policy: { retryLimit: 0, expiresIn: Duration.fromObject({ minutes: 5 }) },
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
    // Nightly, and BEFORE the script-history sweep below, which is the one thing about this
    // schedule that is not a preference: 03:41 reads the material that 04:23 deletes, and a station
    // with a short `render.scriptHistoryDays` would otherwise find the window already thrown away.
    // Forty minutes of headroom because a full roster against one self-hosted model slot is minutes
    // rather than seconds — see `RUN_BUDGET_MS`, which is ten of them.
    //
    // Nightly rather than hourly because what it is looking for is a HABIT: a character develops
    // over days, and a pass every hour would read four breaks at a time and see nothing in them.
    // `MIN_SCRIPTS` is the same argument stated as a floor.
    //
    // One retry. Unlike the sweeps below, a run that failed left its watermarks where they were and
    // has real work outstanding — but only one, because the next night is never far away and the
    // usual reason this fails is the model host being down, which a retry ten minutes later does not
    // fix. `expiresIn` sits above a full run and well below the interval.
    'personas.distil_notes': {
        job: PersonaDistilJob,
        cron: '41 3 * * *',
        policy: { retryLimit: 1, expiresIn: Duration.fromObject({ minutes: 15 }) },
    },

    // Nightly, half an hour after the notebook pass, and the gap is the whole of the schedule: both
    // want the one model slot for minutes at a time, and two passes queued against `LlmGate` at the
    // same minute means the second one spends its `maxWaitMs` waiting and writes nothing.
    //
    // It runs SECOND on purpose. The notebook pass has a deadline — it reads scripts that
    // `render.prune_script_history` deletes at 04:23 — and this one has none at all: what it reads
    // is the station's own library, which is still there tomorrow.
    //
    // One retry, on the distil pass's argument: a failed run has real work outstanding, and the
    // usual reason it failed is the model host being down, which a retry ten minutes later does not
    // fix.
    'personas.write_stories': {
        job: PersonaStoryPassJob,
        cron: '11 4 * * *',
        policy: { retryLimit: 1, expiresIn: Duration.fromObject({ minutes: 15 }) },
    },

    // No cron: an operator asks for an audition, and each transition sends the next. The chain IS
    // the schedule, which is what keeps the station's one model slot free between transitions
    // instead of held for a whole run.
    //
    // NO retry, unlike the two passes above, and for the opposite reason to the sweeps below: a
    // retry here would be a second generation spent on a transition whose row may already hold one.
    // The claim makes a redelivery free rather than harmful, but a RETRY is delivery after a
    // failure, and the failure this actually has is the model host being down — which is the state
    // the run should be reporting to the operator watching it, not silently paying for twice.
    // `expiresIn` sits above one transition's whole wait plus its generation (`patienceFor`'s
    // 30-second default queue, then `BUDGET_MS`) and well below a run.
    'personas.audition': {
        job: PersonaAuditionJob,
        policy: { retryLimit: 0, expiresIn: Duration.fromObject({ minutes: 5 }) },
    },

    // NO retry, unlike everything else here, and the reason is which way the failure falls: a sweep
    // that did not run leaves rows that will be swept tomorrow, and the only thing a retry can buy
    // is a second chance to delete something. Nothing is waiting on it and nothing degrades without
    // it, so the cron IS the retry.
    //
    // Note the pass above reads what this deletes, and runs first. That ordering is load-bearing.
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
