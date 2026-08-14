import { Container, Injectable } from 'injectkit';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import type { ScrobbleResult } from '@deadair/plugin-sdk';
import { PlainJob } from '#modules/jobs/plain.job.js';
import { PluginInvoker } from '#modules/plugins/plugin.invoker.js';
import { StationIdentity } from '#modules/shared/station.identity.js';
import { errorText } from '#modules/shared/error.text.js';
import { ScrobbleRepository, type QueuedScrobble } from './scrobble.repository.js';
import { ScrobbleService } from './scrobble.service.js';

/**
 * The drain: what the station played, told to whoever the operator has asked.
 *
 * The first thing in this codebase that sends anything outward on the station's
 * behalf, which is why everything about it is cautious.
 *
 * ## The cron IS the retry
 *
 * Registered with `retryLimit: 0`, following the two prune jobs. A run that
 * failed leaves every row exactly where it was, with its own backoff, and the
 * next run two minutes later is the retry. A job-level retry would only add a
 * second schedule on top of the row-level one and make the backoff mean less.
 *
 * ## A rejection is classified by the plugin, never guessed here
 *
 * `retryable` is the plugin's judgement, because only it knows what its upstream
 * meant. A retryable rejection is deferred with a doubling backoff; a permanent
 * one is DELETED, because a play the service will never take is not worth a row
 * forever. Getting that backwards in either direction is the failure this job
 * exists to avoid: retry a permanent refusal and the queue never drains, drop a
 * transient one and the listen is gone.
 *
 * ## Batches, per destination
 *
 * Each destination is drained separately and to its own `maxBatchSize`, so one
 * service being down does not hold up another, and so a batch is one request to
 * somebody else's API rather than a hundred.
 */

/**
 * How many batches one destination gets per run.
 *
 * This is what bounds a run, rather than a clock: the work is a small fixed number of requests, so
 * `withRunBudget` would be measuring something that cannot run long. Five batches at a typical
 * twenty a batch is a hundred plays, which is more than a station airing fifteen records an hour
 * can accumulate between two-minute runs — so a backlog drains over several runs rather than in one
 * burst against somebody else's API.
 */
const MAX_BATCHES_PER_DESTINATION = 5;

/** The first backoff after a failure. Doubles per attempt, in SQL, up to the ceiling. */
export const RETRY_BASE_MS = 60_000;

/** The ceiling on that backoff: an hour, which is well inside the retention of the queue itself. */
export const RETRY_MAX_MS = 60 * 60 * 1000;

/**
 * Failures after which a play is given up on.
 *
 * With the backoff above, this is roughly a day of trying. A queue that has been
 * refused a dozen times is a misconfiguration rather than an outage, and the
 * point of the table is to survive an outage.
 */
export const MAX_ATTEMPTS = 12;

@Injectable()
export class ScrobbleFlushJob extends PlainJob {
    constructor(
        private readonly scrobble: ScrobbleService,
        private readonly repository: ScrobbleRepository,
        private readonly pluginInvoker: PluginInvoker,
        private readonly identity: StationIdentity,
        context: JobContext,
        container: Container,
        logger: Logger,
    ) {
        super(context, container, logger);
    }

    protected async execute(_payload?: object, signal?: AbortSignal): Promise<void> {
        const stationKey = this.identity.stationKey;

        // Every destination INSTALLED, not every one accepting. A plugin that has since been told
        // to stop still has rows from when it was accepting, and the honest thing to do with them
        // is neither to send them nor to keep them forever — see the abandon sweep below, which is
        // what eventually clears them.
        const destinations = this.scrobble.destinations();
        if (destinations.length === 0) return;

        const accepting = new Set((await this.scrobble.accepting()).map(destination => destination.record.id));

        let sent = 0;
        let dropped = 0;

        for (const destination of destinations) {
            if (signal?.aborted) break;
            if (!accepting.has(destination.record.id)) continue;

            for (let batch = 0; batch < MAX_BATCHES_PER_DESTINATION; batch += 1) {
                if (signal?.aborted) break;

                const due = await this.repository.due(stationKey, destination.record.id, destination.maxBatchSize);
                if (due.length === 0) break;

                const outcome = await this.send(destination.record.id, due);
                sent += outcome.sent;
                dropped += outcome.dropped;

                // A short batch means the queue is drained; anything else would be a second query
                // returning nothing.
                if (due.length < destination.maxBatchSize) break;
            }
        }

        // Rows nothing will ever take. Swept here rather than in `send` because it is a fact about
        // the row's whole history rather than about this attempt.
        const abandoned = await this.repository.abandon(stationKey, MAX_ATTEMPTS);

        if (sent + dropped + abandoned > 0) {
            this.logger.info('scrobble flush', { job: this.context.id, sent, dropped, abandoned });
        }
    }

    /**
     * One batch to one destination.
     *
     * A THROW means the whole batch failed for one reason — no credentials, the service
     * unreachable — and every row is deferred, which is what the SDK tells a plugin to do with
     * exactly that case. A returned result is per-play, and the rejections are split by whether
     * the plugin said they could ever work.
     */
    private async send(pluginId: string, due: QueuedScrobble[]): Promise<{ sent: number; dropped: number }> {
        const destination = this.scrobble.destinations().find(candidate => candidate.record.id === pluginId);
        if (!destination) return { sent: 0, dropped: 0 };

        let result: ScrobbleResult;
        try {
            result = await this.pluginInvoker.invoke(pluginId, 'scrobble.scrobble', async () =>
                destination.instance.scrobble(due.map(row => row.play)),
            );
        } catch (error) {
            const reason = errorText(error);
            await this.repository.defer(
                due.map(row => row.id),
                reason,
                RETRY_BASE_MS,
                RETRY_MAX_MS,
            );
            this.logger.info(`scrobble: a whole batch was refused, and will be tried again (${pluginId}: ${reason})`);
            return { sent: 0, dropped: 0 };
        }

        const permanent: string[] = [];
        const transient: string[] = [];
        let lastReason = '';

        for (const rejection of result.rejected ?? []) {
            const row = due[rejection.index];
            // An index that names no row is a plugin bug. Ignoring it means that play is treated as
            // accepted below, which is the right way round: a duplicate beats a lost listen.
            if (!row) continue;

            lastReason = rejection.reason;
            (rejection.retryable ? transient : permanent).push(row.id);
        }

        const refused = new Set([...permanent, ...transient]);
        // Everything neither counted nor rejected is treated as accepted, per the SDK: a plugin
        // that quietly dropped one is a worse outcome than a duplicate.
        const accepted = due.filter(row => !refused.has(row.id)).map(row => row.id);

        // Accepted and permanently refused are both DONE with, and both are a delete. The
        // difference between them is only in the log, because nothing downstream reads either.
        await this.repository.forget([...accepted, ...permanent]);
        if (transient.length > 0) await this.repository.defer(transient, lastReason, RETRY_BASE_MS, RETRY_MAX_MS);

        if (permanent.length > 0) {
            this.logger.info(`scrobble: ${permanent.length} play(s) were refused for good and dropped (${pluginId}: ${lastReason})`);
        }

        return { sent: accepted.length, dropped: permanent.length };
    }
}
