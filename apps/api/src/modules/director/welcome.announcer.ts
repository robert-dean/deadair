import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { StationBus } from '#modules/shared/station.bus.js';
import { errorText } from '#modules/shared/error.text.js';
import { DirectorService } from './director.service.js';
import { WELCOME_KIND } from './welcome.writer.js';

/**
 * Somebody tuned in, so ask the station to say hello.
 *
 * The first producer on `StationBus`, and deliberately its own class rather than a subscription
 * inside the director: what the station DOES about a listener arriving is a programming decision,
 * and putting it here means the decision is one readable file rather than a branch in a reactor that
 * already owns the running order.
 *
 * It is also the template for the next one. A news poller publishing `news.received` and a
 * subscriber turning it into `{ kind: 'news', urgency: 'interrupt', context: { headline } }` is this
 * class with two words changed, and neither of them has to know the other exists.
 *
 * ## What it deliberately does not decide
 *
 * Where the break goes, whether the station is on air, whether it can be written at all, whether it
 * has already greeted this listener, and **whether the operator wants greetings at all**. All of
 * those are the director's, because all of them are questions about state this class cannot see —
 * including the last one, which is resolved against the running order rather than the station's own
 * setting, so a broadcast may turn greetings off without an operator touching either. See
 * `DirectorService.requestBreak`. What is left here is the two things a producer really knows: that
 * somebody arrived, and what to ask for.
 */

/**
 * How long the station will not greet anybody again.
 *
 * The case it exists for is not a second listener, which the arrival edge already ignores: it is the
 * SAME listener arriving twice. A phone changing networks, a browser tab reopened, the console's own
 * player being toggled — each of those empties the room and refills it within seconds, and a station
 * that said hello every time would sound broken.
 *
 * Twenty minutes, which is longer than any of those and shorter than a listener who left and came
 * back would count as the same visit. Enforced against the request TABLE rather than in memory, so a
 * restart — the one moment every listener looks like a fresh arrival at once — does not re-greet a
 * room full of people.
 */
export const WELCOME_COOLDOWN_MS = 20 * 60_000;

/** The dedupe key every welcome is taken under. One station, one greeting at a time. */
const WELCOME_KEY = 'welcome';

@Injectable()
export class WelcomeAnnouncer {
    private unsubscribe?: () => void;

    constructor(
        private readonly bus: StationBus,
        private readonly director: DirectorService,
        private readonly logger: Logger,
    ) {}

    /** Begin listening. Idempotent. */
    start(): void {
        if (this.unsubscribe !== undefined) return;

        this.unsubscribe = this.bus.subscribe('audience.arrived', event => this.greet(event.count));
    }

    /** Stop listening. */
    stop(): void {
        this.unsubscribe?.();
        this.unsubscribe = undefined;
    }

    /**
     * Ask for a greeting, and let the director decide whether there is one to be had.
     *
     * Nothing is awaited by the caller: this runs in the audience poll's own stack frame, which has
     * nobody to hand a rejection to. The `catch` is the same one every producer with no caller uses.
     */
    private greet(count: number): void {
        void this.director
            .requestBreak({
                kind: WELCOME_KIND,
                // `next` rather than `interrupt`: a greeting belongs between two records. Talking
                // over the top of one to say hello is what an interruption is for, and this is not
                // an emergency.
                urgency: 'next',
                source: 'audience',
                reason: count === 1 ? 'somebody tuned in' : `${count} listeners tuned in`,
                key: WELCOME_KEY,
                cooldownMs: WELCOME_COOLDOWN_MS,
            })
            .then(result => {
                // At debug when it was declined, because the ordinary decline is the cooldown and an
                // operator does not need a line every time somebody reconnects.
                if (result.accepted) this.logger.info('director: asked the station to welcome a new listener', { listeners: count });
                else this.logger.debug(`director: no welcome for this listener (${result.reason ?? 'the station said nothing'})`);
            })
            .catch(error => this.logger.warn(`director: could not ask the station to welcome a new listener (${errorText(error)})`));
    }
}
