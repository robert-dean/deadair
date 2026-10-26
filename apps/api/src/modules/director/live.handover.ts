import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { LIVE_AUTOMATION_KEY, parseLiveAutomation } from '#modules/playout/live.automation.js';
import { errorText } from '#modules/shared/error.text.js';
import { StationBus, type StationEvents } from '#modules/shared/station.bus.js';
import { DirectorService } from './director.service.js';

/**
 * Hands the air to a presenter on the live input and takes it back afterwards.
 *
 * Listens for the live input's edges on `StationBus`, because they happen in `playout`, which is
 * registered before this module and cannot reach it: the bus's own reason, and `WelcomeAnnouncer`'s
 * shape. What it does about them is a director command, because standing the station down and
 * putting it back are changes to what airs, and those have one writer.
 *
 * Taking the air reads `playout.liveAutomation` at that moment, so an operator who changes it between
 * shows does not need a restart. The hand-back reads nothing: whether the station goes on again is
 * whether a live show stood it down, which the director knows and this does not.
 */
@Injectable()
export class LiveHandOver {
    private unsubscribe?: () => void;

    constructor(
        private readonly bus: StationBus,
        private readonly director: DirectorService,
        private readonly config: AppConfig,
        private readonly logger: Logger,
    ) {}

    /** Begin listening. Idempotent. */
    start(): void {
        if (this.unsubscribe !== undefined) return;

        this.unsubscribe = this.bus.subscribe('live.changed', change => this.handle(change));
    }

    /** Stop listening. */
    stop(): void {
        this.unsubscribe?.();
        this.unsubscribe = undefined;
    }

    private handle(change: StationEvents['live.changed']): void {
        if (change.state === 'onair') {
            if (parseLiveAutomation(this.config.get(LIVE_AUTOMATION_KEY, '')) === 'standDown') this.director.liveTookTheAir();
            return;
        }
        if (change.state === 'off' && change.previous === 'onair') {
            void this.director
                .liveHandedBack()
                .catch(error => this.logger.warn(`director: could not go on again after a live show (${errorText(error)})`));
        }
    }
}
