import { Container, Injectable } from 'injectkit';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { PgBossJobBroker } from '@maroonedsoftware/jobbroker/pgboss';
import { PlainJob } from '#modules/jobs/plain.job.js';
import { withRunBudget } from '#modules/jobs/run.budget.js';
import { EnrichmentService } from './enrichment.service.js';
import { LineupPriorityReader, NO_PRIORITY } from './lineup.priority.js';
import { errorText } from '#modules/shared/error.text.js';

/**
 * Rows examined per run, per kind — a ceiling, not a target.
 *
 * How long a run takes is governed by {@link RUN_BUDGET_MS}, not by this. That
 * split matters: a count only predicts a duration if you know what a request
 * costs, and the honest answer is that nobody does. MusicBrainz asks for one
 * request a second and usually answers well inside that, but under load it
 * answers in ten, or it sheds with a 503 and the host spends the budget backing
 * off and retrying. Sizing the batch as `requests × one second` quietly assumed
 * the good case and overran the cron interval in the bad one, which is how two
 * runs end up on the same limiter starving each other into timeouts — and three
 * consecutive timeouts quarantine the plugin outright.
 *
 * So the number is generous and the clock is what stops the walk. Whatever is
 * left is picked up by the next run, and there is always a next run.
 */
const BATCH_SIZE = 75;

/**
 * How long a run may keep asking for more work before it stops.
 *
 * Comfortably inside the cron interval and inside the job's `expiresIn`, so a
 * slow upstream cannot make one run collide with the next however slow it gets.
 * The passes check the signal between entities, so this stops the walk at the
 * next clean boundary rather than abandoning a track mid-flight: a row nothing
 * reached is simply still outstanding.
 */
export const RUN_BUDGET_MS = 11 * 60 * 1000;

export interface EnrichmentPayload {
    /** Overrides {@link BATCH_SIZE} for one run. Absent, as it always is from cron, means the default. */
    limit?: number;
}

/**
 * The scheduled enrichment walk: tracks, then the artists and records behind
 * them.
 *
 * A plain `Job` rather than a `TransactionalJob`, for the same reason
 * `CatalogSyncJob` is: this is a long walk with rate-limited network in the
 * middle of it, and wrapping it would pin a runtime-pool connection and hold
 * one snapshot open for the length of the walk. Each track settles on its own.
 */
@Injectable()
export class EnrichmentJob extends PlainJob<EnrichmentPayload> {
    constructor(
        private readonly enrichment: EnrichmentService,
        private readonly priority: LineupPriorityReader,
        private readonly jobs: PgBossJobBroker,
        context: JobContext,
        container: Container,
        logger: Logger,
    ) {
        super(context, container, logger);
    }

    protected async execute(payload?: EnrichmentPayload, signal?: AbortSignal): Promise<void> {
        const limit = payload?.limit ?? BATCH_SIZE;

        // Read ONCE, here, and handed to all three passes. It is the running order as it stood when
        // the run began, which is the honest thing for a walk that may take minutes: re-reading per
        // pass would cost three queries to chase an order that has moved by a track, and the passes
        // would then disagree about which artist went with which record.
        //
        // Failing to read it is not a reason to skip the run. The walk without a priority is exactly
        // the walk that ran before this existed, and the records ahead of the cursor are still in the
        // queue — they simply wait their turn. So this degrades to the old behaviour rather than to
        // no behaviour, which is the same trade the whole enrichment path is built on.
        const priority = await this.priority.read().catch(error => {
            this.logger.warn('enrichment: could not read what the station is about to play', { error: errorText(error) });
            return NO_PRIORITY;
        });

        const { result, outOfTime } = await withRunBudget(RUN_BUDGET_MS, signal, async stop => {
            // Tracks first, and all three in the same run rather than three jobs.
            // The artist pass wants `artists.mbid`, which the track pass promotes
            // for free off the recording's artist credit, and separate jobs would
            // put three walks on the same one-request-per-second limiter.
            const tracks = await this.enrichment.enrichPending(limit, stop, priority.trackIds);
            const artists = await this.enrichment.enrichPendingArtists(limit, stop, priority.artistIds);
            const albums = await this.enrichment.enrichPendingAlbums(limit, stop, priority.albumIds);
            return { tracks, artists, albums };
        });

        // Quiet when there was nothing to do: with a cron this frequent, an
        // idle station would otherwise write a line every few minutes saying so.
        if (result.tracks.scanned + result.artists.scanned + result.albums.scanned > 0) {
            // `ahead` says how much of this run was work the station is about to need, which is the
            // one number that tells an operator whether the priority is doing anything: a run
            // reporting zero on a station that is on air is a running order already described.
            // `outOfTime` is the signal that the upstream is slow enough to
            // be the thing setting the pace. It is not an error — the walk
            // stopped where it was told to — but a run that reports it every
            // time is one whose sources are struggling.
            this.logger.info('enrichment pass', { job: this.context.id, ...result, ahead: priority.trackIds.length, outOfTime });
        }

        // Read what was just fetched, rather than leaving it for the extractor's own cron.
        //
        // The two halves are a pipeline: this pass stores the prose a plugin handed over, and
        // `catalog.extract_facts` turns it into the claims a break is actually shown. Winning minutes
        // on the fetch and then waiting a quarter hour to read it would give them straight back — and
        // the reason the whole walk now leads with the running order is that those minutes are the
        // difference between a record being described and airing anonymously.
        //
        // Sent on ENRICHED rather than on scanned, because a pass that only wrote miss rows produced
        // no document to read. Cheap and safe either way: the extractor reads local rows and does
        // arithmetic, so unlike the walk it contends with nothing.
        //
        // Swallowed, on this file's own rule. Its cron is the backstop, and a document that was not
        // read keeps no mark — so it is still outstanding and the next pass finds it.
        if (result.tracks.enriched + result.artists.enriched + result.albums.enriched > 0) {
            await this.jobs
                .send('catalog.extract_facts', {})
                .catch(error => this.logger.warn('enrichment: could not ask for the new documents to be read', { error: errorText(error) }));
        }
    }
}
