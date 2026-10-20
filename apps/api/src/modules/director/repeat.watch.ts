import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { ActivityRecorder } from '#modules/activity/activity.recorder.js';

/**
 * Says out loud when the repeat window had to give way to fill a batch.
 *
 * `PickResolver` lets records the window refused back in, longest off air first, when the rules
 * left a refill with nothing at all (see `letRepeatsBackIn`). That is the right thing for the air
 * and the wrong thing to do silently: it means everything the station may currently draw has aired
 * inside the window, which an operator fixes by widening what the broadcast may play or shortening
 * the window, and neither is a fix anybody makes without being told.
 *
 * Told by the resolver alone, which is the step that decides what airs. The floor gives way the
 * same way and says nothing: a repeat it let back in can still be dropped there for a fresh record,
 * and a floor raising this flag while the resolver lowered it would put a row on the feed for every
 * refill.
 *
 * Its own singleton for `EraWatch`'s reason: the resolver is scoped, so an edge flag on it
 * would reset before it could suppress anything and the feed would take a row per refill. A
 * boolean rather than a key, because the window giving way is one condition whatever let it.
 *
 * Never throws, like everything that writes to the feed.
 */
@Injectable()
export class RepeatWatch {
    /** Whether a give-way is outstanding. */
    private reported = false;

    constructor(
        private readonly activity: ActivityRecorder,
        private readonly logger: Logger,
    ) {}

    /**
     * The rising edge: a batch needed records the window refused.
     *
     * @param letBack - How many it let back in.
     * @param windowDays - The window in force, which rides the sentence because it is one of the two
     *   things an operator can change about this.
     */
    gaveWay(letBack: number, windowDays: number): void {
        if (this.reported) return;
        this.reported = true;

        this.logger.warn('director: every record the station may draw aired inside the repeat window, so it let the longest off air back in', {
            letBack,
            windowDays,
        });
        void this.activity.record({
            module: 'director',
            kind: 'rotation.repeatWindowGaveWay',
            detail:
                `Every record this broadcast may play has aired in the last ${windowDays} days, so the station let ${letBack} back in, ` +
                'the ones longest off air first, rather than run short. Widening what the broadcast plays or shortening the repeat ' +
                'window stops it repeating.',
            data: { letBack, windowDays },
        });
    }

    /**
     * The falling edge. Called on every batch that filled without the window giving way, so the next
     * time it happens is reported rather than suppressed for the life of the process.
     */
    clear(): void {
        if (!this.reported) return;
        this.reported = false;
        this.logger.info('director: the station can fill a batch inside the repeat window again');
    }
}
