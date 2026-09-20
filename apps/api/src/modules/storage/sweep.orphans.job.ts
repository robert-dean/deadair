import { Container, Injectable } from 'injectkit';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { ActivityRecorder } from '#modules/activity/activity.recorder.js';
import { PlainJob } from '#modules/jobs/plain.job.js';
import { StorageService } from './storage.service.js';

/**
 * Delete the media files no row points at any more.
 *
 * ## Why a job rather than the thing that made the orphan
 *
 * The tempting place to unlink a file is wherever its row was deleted, which would leave nothing to
 * sweep at all. It is wrong for the reason the store's own `remove` gives: content addressing makes
 * identical audio ONE file, so the code deleting a row cannot know whether the checksum it held is
 * still wanted without asking about every other row, and the answer changes between the ask and the
 * unlink. Sweeping from the whole set is the version of that question with an answer — and it also
 * catches the orphans no row deletion made, which on this station is most of them: a crash between
 * writing bytes and writing the row leaves a file nothing ever knew about.
 *
 * ## Nightly, last
 *
 * At 05:17, after the whole nightly cluster — the two persona passes, `render.prune_script_history`
 * at 04:23 and `activity.prune_events` at 04:53 — so anything those free is swept the same night
 * instead of sitting for a day. That ordering is a tidiness rather than a correctness rule, unlike
 * the notebook pass and the script prune, which genuinely race.
 *
 * Nightly rather than the quarter-hour {@link SweepTrackCacheJob} runs at, because the two bound
 * different things. That one is holding a cache under a CAP, so overshoot between passes is the
 * cost and fifteen minutes is how tightly it is bounded. Nothing is bounded here. Orphans accrue at
 * a handful a day and every one of them is already unreachable, so sweeping at noon rather than at
 * dawn changes nothing an operator can observe except the hour the disk figure moves.
 *
 * `retryLimit: 0`, like both prune jobs and the cache sweep, and for the reason they all give: a
 * sweep that did not run leaves files that will be swept tomorrow, nothing is waiting on it, and the
 * only thing a retry can buy is a second chance to delete something.
 */
@Injectable()
export class SweepOrphansJob extends PlainJob {
    constructor(
        private readonly storage: StorageService,
        private readonly activity: ActivityRecorder,
        context: JobContext,
        container: Container,
        logger: Logger,
    ) {
        super(context, container, logger);
    }

    protected async execute(): Promise<void> {
        const result = await this.storage.sweep();

        // Silent for a station that has never turned this on, which is every station until somebody
        // does. A line a night saying nothing happened is how a log stops being read.
        if (!result.ran) return;

        if (result.removed === 0) {
            // Still silent on the feed, but worth a line here: a run that holds files back every
            // night and never takes any is something writing files nothing claims, which is a fault
            // upstream of this and invisible without it.
            if (result.heldBack > 0) this.logger.info('storage: nothing old enough to sweep yet', { heldBack: result.heldBack });

            return;
        }

        this.logger.info('storage: deleted media files no row points at', {
            removed: result.removed,
            freedBytes: result.freedBytes,
            heldBack: result.heldBack,
        });

        // ONE row carrying a count, as `cache.swept` is and for the same reason: a sweep of forty
        // files is one thing that happened. What it is doing on the feed at all is that this is the
        // station deleting audio, and an operator who turned a switch on a month ago is owed the
        // sight of it working rather than a disk figure that quietly moved.
        void this.activity.record({
            module: 'storage',
            kind: 'orphans.swept',
            severity: 'info',
            detail:
                `The station deleted ${result.removed} media ${result.removed === 1 ? 'file' : 'files'} that nothing points at any more, freeing ${megabytes(result.freedBytes)}` +
                (result.heldBack > 0 ? `, and left ${result.heldBack} alone as too recently written to be sure about.` : '.'),
            data: {
                removed: result.removed,
                freedBytes: result.freedBytes,
                heldBack: result.heldBack,
            },
        });
    }
}

/** For the one sentence an operator reads, where bytes are the wrong unit. */
const megabytes = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
