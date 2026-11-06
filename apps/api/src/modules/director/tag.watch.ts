import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { ActivityRecorder } from '#modules/activity/activity.recorder.js';

/**
 * Says out loud when a steered genre is one nobody has tagged anything with.
 *
 * Tags are a folksonomy with no closed list, so a steer typed `synthwav` or `80s dark synth` asks a
 * real question whose honest answer is nothing. That answer costs `TagSetGenerator` its share and
 * the floor fills it, so the station sounds fine and the steer quietly does half of what it was
 * asked. The same shape as the advisory policy's `clean-only` with no clean copies: the answer is
 * "nothing to play", and it has to be SAID rather than looking like a source that is down.
 *
 * Only when a source ANSWERED empty (`SimilarityService.askTagged`). A source that failed is a
 * fault of the source, logged where it happened, and not something an operator fixes by retyping a
 * genre.
 *
 * ## Its own singleton, keyed by the genres
 *
 * `EraWatch`'s reason: the generator is scoped, so an edge flag on it would reset every refill and
 * the feed would take a row each time. The key is the steer's genres, so an operator who corrects
 * the spelling has asked a new question and hears the new answer.
 *
 * Never throws, like everything that writes to the feed.
 */
@Injectable()
export class TagWatch {
    /** The genres last reported on, as one key. `undefined` is nothing outstanding. */
    private reported?: string;

    constructor(
        private readonly activity: ActivityRecorder,
        private readonly logger: Logger,
    ) {}

    /** The rising edge: a source answered that nothing carries any of these genres. */
    nothingTagged(genres: readonly string[]): void {
        const key = keyOf(genres);
        if (this.reported === key) return;
        this.reported = key;

        const named = genres.map(genre => `"${genre}"`).join(', ');
        this.logger.warn('director: nothing is tagged with the steered genres, so the steer reaches no records the library does not hold', {
            genres,
        });
        void this.activity.record({
            module: 'director',
            kind: 'rotation.steerUntagged',
            severity: 'warn',
            detail:
                `The station is leaning toward ${named}, and no record anywhere it can look is tagged with ${genres.length === 1 ? 'it' : 'any of them'}, ` +
                'so the lean only reaches records the library already holds. Check the spelling, or use a plainer genre word such as "synthwave".',
            data: { genres: [...genres] },
        });
    }

    /** The falling edge, called whenever a steer's genres found records, so recovering is not suppressed for good. */
    found(): void {
        if (this.reported === undefined) return;
        this.reported = undefined;
        this.logger.info('director: records are tagged with the steered genres again');
    }
}

/** The genres as one key, in any order and any case, so the same steer reads as the same question. */
const keyOf = (genres: readonly string[]): string => [...new Set(genres.map(genre => genre.trim().toLowerCase()))].sort().join('\u0000');
