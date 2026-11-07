import { Container, Injectable } from 'injectkit';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { PlainJob } from '#modules/jobs/plain.job.js';
import { AnalysisService } from './analysis.service.js';

export interface AnalyseTrackPayload {
    /**
     * The binding whose audio just arrived, as `track_sources.id`: the key `playout.cache_track`
     * fetched by, so the sender passes on exactly what it was given.
     *
     * Optional in the type and required in practice, for `CacheTrackPayload.sourceId`'s reason.
     */
    sourceId?: string;
}

/**
 * Measure one record as soon as its audio is on this machine.
 *
 * The hourly `catalog.analyze` walk measures a cached record within the hour, and that is too late
 * for the one case that matters most: a record the cache-ahead step fetched in the hour before its
 * slot. The director re-reads a measurement onto a planned item right up to air (`remeasure`), but
 * only one that exists, so a record whose measurement landed after it aired went out at its raw level
 * with no trim, and nothing said so. This closes that gap from the other end: `CacheTrackJob` sends
 * this when it has the bytes, and the measurement exists minutes after the fetch rather than up to an
 * hour after.
 *
 * The walk stays as the backfill, for everything this does not reach: the library at large, a record
 * fetched on the spot by the audio route rather than ahead, and a measurement that failed and is due
 * again.
 *
 * **Duplicates collapse on the track's own row rather than in the queue.** The queue runs one of
 * these at a time (see `job.mappings.ts`), and each one starts by asking the walk's own question of
 * that one track, so a second job for a record the first has measured costs a query and stops. Two
 * bindings of one recording fetched together are the same case: one measurement, as the walk would
 * take.
 *
 * A plain `Job`, for `AnalysisJob`'s reason: a decode in the middle of a transaction would pin a
 * runtime-pool connection for its length, and the write at the end is one row.
 */
@Injectable()
export class AnalyseTrackJob extends PlainJob<AnalyseTrackPayload> {
    constructor(
        private readonly analysis: AnalysisService,
        context: JobContext,
        container: Container,
        logger: Logger,
    ) {
        super(context, container, logger);
    }

    protected async execute(payload?: AnalyseTrackPayload): Promise<void> {
        if (!payload?.sourceId) {
            // A caller's bug, as with the cache job: this is only ever sent, so a run with no binding
            // means nothing.
            this.logger.warn('analysis: a track measurement job was sent with no binding', { job: this.context.id });
            return;
        }

        const outcome = await this.analysis.analyseSource(payload.sourceId);

        // Said only when the analyzer was actually asked. `current` is a duplicate or a record already
        // measured, and `none` is a station with no analyzer, both ordinary and both every time.
        if (outcome === 'measured' || outcome === 'failed') {
            this.logger.info('analysis: measured a record as it arrived', { job: this.context.id, source: payload.sourceId, outcome });
        }
    }
}
