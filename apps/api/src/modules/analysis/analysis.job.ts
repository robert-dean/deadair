import { Container, Injectable } from 'injectkit';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { PlainJob } from '#modules/jobs/plain.job.js';
import { withRunBudget } from '#modules/jobs/run.budget.js';
import { AnalysisService } from './analysis.service.js';

/**
 * Tracks DOWNLOADED per run — a ceiling, not a target, and the only number here that costs the
 * station anything.
 *
 * **Measuring a track the station does not already hold is a FULL AUDIO DOWNLOAD through the same
 * provider credential playout is using.** That is the whole constraint: analysis and playout share
 * one upstream, and **playout wins every time** — an unmeasured track plays perfectly well, and a
 * station that cannot fetch audio plays nothing at all.
 *
 * It is worth stating what that constraint is NOT: a first run at 50 was followed by the shim
 * failing to retrieve audio keys, and that looked like cause and effect until the log turned out to
 * go back six days with the same errors in it. The burst may have made a bad patch worse; it did
 * not invent the problem. Do not go looking for a fix to a bug this constant was blamed for.
 *
 * Fifteen, against a cron that fires hourly and a station that plays about fifteen records an hour,
 * so the background work is at most the foreground's own load rather than the six times it would be
 * at fifty. It was five, which is defensible and was measured to be too slow to matter: with 625
 * tracks outstanding it is five days of a station levelling nothing, and an unmeasured record is
 * exactly what leaves `normalize` improvising a level — which is audible as quiet music with a ramp
 * at every boundary.
 *
 * **A local library has no such limit, and that is now enforced rather than noted.** A track whose
 * audio `TrackAudioService` already holds pays no provider credential at all, so it does not count
 * against this at all — see {@link SCAN_BATCH_SIZE}.
 */
const PROVIDER_BATCH_SIZE = 15;

/**
 * Tracks LOOKED AT per run, which is a different and much larger number.
 *
 * `listTracksNeedingAnalysis` hands over the tracks whose audio is already here first, and those
 * cost nothing but decode time — paced by `analysis.localPaceMs` and bounded by
 * {@link RUN_BUDGET_MS}, both of which stay. So a run walks as far as this into the queue and stops
 * when it has spent {@link PROVIDER_BATCH_SIZE} downloads, which in practice means it drains
 * everything already on the machine and then does its small share of fetching.
 *
 * The tracks the station has actually been playing are the cached ones, so this is also the
 * ordering that measures rotation first, which is where an unlevelled record is heard.
 */
const SCAN_BATCH_SIZE = 250;

/**
 * How long a run may keep starting new measurements.
 *
 * Comfortably inside the cron interval and inside the job's `expiresIn`, so a
 * slow analyzer cannot make one run collide with the next. The walk checks the
 * signal between tracks, so this stops it at a clean boundary rather than
 * abandoning a decode already in flight — that one is paid for either way, and
 * dropping it would leave the analyzer working on something nothing will store.
 */
export const RUN_BUDGET_MS = 25 * 60 * 1000;

export interface AnalysisPayload {
    /** Overrides {@link SCAN_BATCH_SIZE} for one run. Absent, as it always is from cron, means the default. */
    limit?: number;
    /** Overrides {@link PROVIDER_BATCH_SIZE} for one run. The one to raise deliberately, and to put back. */
    providerLimit?: number;
}

/**
 * The scheduled measurement walk.
 *
 * A plain `Job` rather than a `TransactionalJob`, following `EnrichmentJob` and
 * for a sharper version of its reason: this is a long walk with a full audio
 * download and decode in the middle of each step, and wrapping it would pin a
 * runtime-pool connection and hold one snapshot open for the length of it. Each
 * track settles on its own.
 */
@Injectable()
export class AnalysisJob extends PlainJob<AnalysisPayload> {
    constructor(
        private readonly analysis: AnalysisService,
        context: JobContext,
        container: Container,
        logger: Logger,
    ) {
        super(context, container, logger);
    }

    protected async execute(payload?: AnalysisPayload, signal?: AbortSignal): Promise<void> {
        const limit = payload?.limit ?? SCAN_BATCH_SIZE;
        const providerLimit = payload?.providerLimit ?? PROVIDER_BATCH_SIZE;

        const { result: summary, outOfTime } = await withRunBudget(RUN_BUDGET_MS, signal, stop =>
            this.analysis.analysePending(limit, stop, {}, providerLimit),
        );

        // Quiet when there was nothing to do. Once a library is measured this
        // is every run, and a station that has finished should not say so
        // every half hour.
        if (summary.scanned > 0) {
            this.logger.info('analysis pass', { job: this.context.id, ...summary, outOfTime });
        }
    }
}
