import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { ActivityRecorder } from '#modules/activity/activity.recorder.js';

/**
 * Says out loud when the station's advisory policy has left it nothing to play.
 *
 * `clean-only` demands a positively `clean` copy, and most providers never mark one — a library
 * synced from a source with no such field has nothing marked at all. That is the documented cost of
 * the strict reading, and it is a perfectly correct state for the code to be in. What it must not be
 * is a SILENT one: a station drawing zero records because of a policy and a station drawing zero
 * records because its catalog is empty produce exactly the same silence, and they want opposite
 * fixes. Nothing else in the chain can tell them apart, because by the time a short batch reaches
 * `SetGeneratorChain.announce` the reason is gone.
 *
 * ## Its own singleton, and why
 *
 * Only to hold one boolean. Every set generator is scoped — a fresh instance per refill — so an
 * edge flag on the one that discovers this would reset before it could suppress anything, and the
 * feed would take a row every time the station tried and failed. `station_events` producers write
 * on EDGES; a row per reading is a log file with a primary key. This mirrors
 * `DirectorService.waitingOnAudioReported` exactly, and exists separately only because the fact is
 * discovered somewhere the flag cannot live.
 *
 * Never throws, like everything that writes to the feed: nothing reads these rows to decide
 * anything, and failing to describe a silent station must not also be what silenced it.
 */
@Injectable()
export class AdvisoryWatch {
    private reported = false;

    constructor(
        private readonly activity: ActivityRecorder,
        private readonly logger: Logger,
    ) {}

    /**
     * The rising edge: the policy emptied a draw the library could otherwise have filled.
     *
     * @param playable - How many records the same draw found with the policy off. A SAMPLE and not
     *   a library total — `CandidatesRepository.sample` draws up to twelve times what was asked for
     *   and stops — so the sentence says "at least" rather than quoting it as the size of the
     *   catalog. It is worth carrying at all only because "you have records and none are marked" is
     *   actionable where "the station found nothing" is not.
     */
    starved(playable: number): void {
        if (this.reported) return;
        this.reported = true;

        this.logger.warn('director: the station is set to play only records marked clean, and nothing it can draw is marked clean', {
            playableSample: playable,
        });
        void this.activity.record({
            module: 'director',
            kind: 'rotation.advisoryStarved',
            detail:
                'The station is set to play only records marked clean, and none of the records it can otherwise play carry that mark ' +
                `(at least ${playable} of them). Most music sources never say either way, so it will stay silent until one that does is ` +
                'connected, or until the setting is changed.',
            data: { playableSample: playable },
        });
    }

    /**
     * The falling edge. Called on every draw that found something, so recovering is reported the
     * next time it happens rather than being suppressed for the life of the process.
     */
    clear(): void {
        if (!this.reported) return;
        this.reported = false;
        this.logger.info('director: the station can draw records again');
    }
}
