import { Container, Injectable, ScopedContainer } from 'injectkit';
import { Job, JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { overrideJobActor } from '#modules/jobs/job.authorization.js';
import { AnalysisService } from './analysis.service.js';

/**
 * Tracks examined per run — a ceiling, not a target, and a deliberately tiny one.
 *
 * **This number is small because measuring a track costs a FULL AUDIO DOWNLOAD
 * through the same provider credential the station plays on.** It was 50 for one
 * afternoon and that was enough to take the station off the air: fifty
 * back-to-back track fetches exhausted Spotify's audio-key quota, after which the
 * shim could not serve playout either. Zero key failures before that run, ninety
 * after it. The station could not play music because a background job had spent
 * its ability to.
 *
 * So the constraint here is not CPU, and it is not the analyzer. It is that
 * analysis and playout share one upstream and one credential, and **playout wins
 * every time**. Five per run, paced by `TRACK_PACE_MS` in `analysis.service.ts`,
 * is roughly a track an hour of provider traffic on top of whatever the station
 * is actually playing. The pace lives over there rather than beside this constant
 * because the job imports the service, so the reverse would be a cycle.
 *
 * A library is measured over days rather than in an afternoon, which is the right
 * trade: an unmeasured track plays perfectly well, and a station that cannot
 * fetch audio plays nothing at all.
 *
 * A local library has no such limit, and this will be worth revisiting per
 * provider once one exists. Until then the cautious number governs.
 */
const BATCH_SIZE = 5;

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
    /** Overrides {@link BATCH_SIZE} for one run. Absent, as it always is from cron, means the default. */
    limit?: number;
}

/**
 * The scheduled measurement walk.
 *
 * A plain `Job` rather than a `TransactionalJob`, following `EnrichmentJob` and
 * for a sharper version of its reason: this is a long walk with a full audio
 * download and decode in the middle of each step, and wrapping it would pin a
 * runtime-pool connection and hold one snapshot open for the length of it. Each
 * track settles on its own.
 *
 * Because it is not transactional, the actor has to be installed here; nothing
 * else in a plain job's scope does it.
 */
@Injectable()
export class AnalysisJob implements Job<AnalysisPayload> {
    constructor(
        private readonly analysis: AnalysisService,
        private readonly context: JobContext,
        // `Container` resolves to the container doing the resolving, which for a
        // job is the runner's per-execution scope. `ScopedContainer` is a type
        // alias, not a token, so it can only be the cast — same as EnrichmentJob.
        private readonly container: Container,
        private readonly logger: Logger,
    ) {}

    async run(payload?: AnalysisPayload, signal?: AbortSignal): Promise<void> {
        overrideJobActor(this.container as ScopedContainer, this.context);
        const limit = payload?.limit ?? BATCH_SIZE;

        // A plain controller on a plain timer rather than `AbortSignal.timeout`,
        // for the reason `plugin.invocation.deadline.ts` gives: that one's timer
        // is unref'd and invisible to fake timers, which would make the budget
        // untestable.
        const budget = new AbortController();
        const timer = setTimeout(() => budget.abort(), RUN_BUDGET_MS);
        const stop = signal ? AbortSignal.any([signal, budget.signal]) : budget.signal;

        try {
            const summary = await this.analysis.analysePending(limit, stop);

            // Quiet when there was nothing to do. Once a library is measured this
            // is every run, and a station that has finished should not say so
            // every half hour.
            if (summary.scanned > 0) {
                this.logger.info('analysis pass', { job: this.context.id, ...summary, outOfTime: budget.signal.aborted });
            }
        } finally {
            clearTimeout(timer);
        }
    }
}
