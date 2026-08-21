import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { ActivityRecorder } from '#modules/activity/activity.recorder.js';
import type { EraWindow } from './candidates.repository.js';

/**
 * Says out loud when the period a broadcast was asked for has left it nothing to play.
 *
 * A station told to play 1968 to 1979 over a library of nineties rock draws nothing, and that is the
 * period working rather than failing: `rotation.briefOnly` already establishes the rule this follows
 * — a station told "flamenco guitar" runs SHORT rather than finishing the hour with whatever else
 * the library holds. Relaxing would be worse than useless here, because the draw and `PickResolver`
 * apply the same window: a floor that quietly widened would hand the resolver picks the resolver
 * then drops, which is an empty refill with an extra step.
 *
 * What it must not be is SILENT. A station drawing zero records because of a period and one drawing
 * zero because its catalog is empty produce the same short refill and want opposite fixes, and by
 * the time `SetGeneratorChain.announce` sees a short batch the reason is gone.
 *
 * ## The second draw is what makes the sentence true
 *
 * Told apart exactly as `AdvisoryWatch` tells its two cases apart: ask the same draw again with the
 * period off. That costs a round trip only when a draw already came back empty, which is a state
 * the station cannot programme out of anyway, and nothing at all the rest of the time.
 *
 * **A year the catalog does not know is eligible for any period**, so an empty draw here is never
 * merely "nothing is tagged" — the records that fell out are ones the catalog HAS dated, outside the
 * window. That is what makes "your library has records, none of them from these years" an honest
 * sentence rather than a guess about metadata.
 *
 * ## Its own singleton, keyed by period
 *
 * `AdvisoryWatch`'s reason: every set generator is scoped, so an edge flag on the one that discovers
 * this would reset before it could suppress anything and the feed would take a row per refill. The
 * key is the WINDOW rather than a bare boolean, because an operator narrowing 1970-1979 to 1975-1975
 * after reading the first row has asked a new question and deserves a new answer.
 *
 * Never throws, like everything that writes to the feed.
 */
@Injectable()
export class EraWatch {
    /** The period last reported on, as its own key. `undefined` is nothing outstanding. */
    private reported?: string;

    constructor(
        private readonly activity: ActivityRecorder,
        private readonly logger: Logger,
    ) {}

    /**
     * The rising edge: the period emptied a draw the library could otherwise have filled.
     *
     * @param era - The window in force, which rides the sentence because "the station found nothing"
     *   is unactionable and "nothing from 1968 to 1979" is one edit away from being fixed.
     * @param playable - How many records the same draw found with the period off. A SAMPLE rather
     *   than a library total, exactly as `AdvisoryWatch.starved` reports one, so the sentence says
     *   "at least".
     */
    starved(era: EraWindow, playable: number): void {
        const key = keyOf(era);
        if (this.reported === key) return;
        this.reported = key;

        const window = describe(era);
        this.logger.warn('director: the period this broadcast plays has left the station nothing to draw', { era, playableSample: playable });
        void this.activity.record({
            module: 'director',
            kind: 'rotation.eraStarved',
            detail:
                `This broadcast plays ${window}, and none of the records the station can otherwise play fall inside it (at least ` +
                `${playable} of them do not). It will run short rather than play the wrong period. A record whose release year the ` +
                'catalogue does not know is always eligible, so this is about records it has dated.',
            data: { playableSample: playable, ...(era.from === undefined ? {} : { eraFrom: era.from }), ...(era.to === undefined ? {} : { eraTo: era.to }) },
        });
    }

    /**
     * The falling edge. Called on every draw that found something, so recovering is reported the
     * next time it happens rather than being suppressed for the life of the process.
     */
    clear(): void {
        if (this.reported === undefined) return;
        this.reported = undefined;
        this.logger.info('director: the station can draw records inside its period again');
    }
}

/** One window as one string, so a narrowed period reads as a new question rather than the same one. */
const keyOf = (era: EraWindow): string => `${era.from ?? ''}-${era.to ?? ''}`;

/** The window as the feed says it. Three shapes, because an open end is an ordinary request. */
function describe(era: EraWindow): string {
    if (era.from !== undefined && era.to !== undefined) return `records from ${era.from} to ${era.to}`;
    if (era.from !== undefined) return `records from ${era.from} onwards`;

    return `records from ${era.to} and earlier`;
}
