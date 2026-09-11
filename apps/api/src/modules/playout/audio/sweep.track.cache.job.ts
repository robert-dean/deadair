import { Container, Injectable } from 'injectkit';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { Logger } from '@maroonedsoftware/logger';
import { ActivityRecorder } from '#modules/activity/activity.recorder.js';
import { PlainJob } from '#modules/jobs/plain.job.js';
import { TrackAudioService } from './track.audio.service.js';

/**
 * Bring the station's own copies of records back under the cap an operator set.
 *
 * ## Why this is a job and not part of the commit pass
 *
 * The obvious place to hang eviction is the ripener, which already runs on every commit pass and
 * already knows the window. It is the wrong place twice over: the commit pass is the loop that keeps
 * the running order full, and it is the one an operator HEARS when it is slow, so deleting files
 * inside it puts filesystem work on the path to air. And the ripener's subject is the fetch window,
 * not the disk. What it keeps is one line — `TrackAudioService.protect` — publishing the set of
 * records this must not touch.
 *
 * ## Why a schedule is not the thing [track-cache-eviction](https://github.com/robert-dean/deadair/discussions/46) argued against
 *
 * That file refuses "evicting on a schedule", and it is right: a nightly sweep deleting a week-old
 * record on a station with terabytes free is worse than doing nothing. **The cap is the trigger here
 * and age is only the order.** An under-cap run reads one aggregate and stops, so a station inside
 * its cap is untouched however often this fires, and a station with no cap set does not even get
 * that far.
 *
 * ## Every fifteen minutes, and no retry
 *
 * The cache grows only when a record is fetched, which on an airing station is a few records an
 * hour, so fifteen minutes bounds the overshoot at a few records' worth of bytes. Rarer would let a
 * discovery burst run away between passes; denser would be polling a number that has usually not
 * moved.
 *
 * `retryLimit: 0`, like the two prune jobs and for the same reason: a sweep that did not run leaves
 * a cache that will be swept in fifteen minutes, and nothing is waiting on it. The cron IS the
 * retry, and a job-level retry would only ever buy a second chance to delete something.
 */
@Injectable()
export class SweepTrackCacheJob extends PlainJob {
    constructor(
        private readonly audio: TrackAudioService,
        private readonly activity: ActivityRecorder,
        context: JobContext,
        container: Container,
        logger: Logger,
    ) {
        super(context, container, logger);
    }

    protected async execute(): Promise<void> {
        const result = await this.audio.sweep();
        if (result.evicted === 0) {
            // Silent on the ordinary case, which is every fifteen minutes forever on a station under
            // its cap. A run that could not free anything while still over is worth a line, because
            // it means everything the station holds is either about to air or being fetched.
            if (result.stillOver) {
                this.logger.warn('playout: over the record cache cap with nothing safe to drop', {
                    heldBytes: result.heldBytes,
                    capBytes: result.capBytes,
                });
            }
            return;
        }

        this.logger.info('playout: dropped the coldest records to get back under the cache cap', {
            evicted: result.evicted,
            freedBytes: result.freedBytes,
            heldBytes: result.heldBytes,
            capBytes: result.capBytes,
        });

        // ONE row carrying a count, not one per record — the same call `order.caughtUp` makes. A
        // sweep of forty records is one thing that happened, and forty rows would bury the feed in
        // housekeeping. What it is doing on the feed at all is explaining the re-fetches that follow
        // it, which otherwise read as the station churning for no reason.
        void this.activity.record({
            module: 'playout',
            kind: 'cache.swept',
            severity: 'info',
            detail:
                `The station dropped ${result.evicted} of its least recently played records to stay under its cache limit` +
                (result.stillOver ? ', and is still over it because everything left is about to air.' : '.'),
            data: {
                evicted: result.evicted,
                freedBytes: result.freedBytes,
                heldBytes: result.heldBytes,
                capBytes: result.capBytes,
                stillOver: result.stillOver,
            },
        });
    }
}
