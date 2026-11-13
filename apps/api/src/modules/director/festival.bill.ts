import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { FestivalRepository } from '#modules/schedule/festival.repository.js';
import type { Festival } from '#modules/schedule/festival.rules.js';
import { errorText } from '#modules/shared/error.text.js';

/**
 * The festival a show is built around, read once for whoever in this scope asks.
 *
 * A refill runs in a job's own scope and asks twice (the festival's own binding, then the model's prompt),
 * and a break asks once, so this holds the answer per id for the life of the scope rather than
 * reading the row for each. Never across scopes: an operator's correction to the bill or the dates is
 * meant to reach the show at its next refill and its next break.
 *
 * Nothing here throws. A festival that is not there, or a read that fails, answers `undefined`, which
 * every caller treats as a show built around no festival: a show that cannot read its festival should
 * still play.
 */
@Injectable()
export class FestivalBill {
    private readonly read = new Map<string, Promise<Festival | undefined>>();

    constructor(
        private readonly festivals: FestivalRepository,
        private readonly logger: Logger,
    ) {}

    /** The festival, with its bill in the operator's order, or `undefined`. */
    async of(festivalId: string | undefined): Promise<Festival | undefined> {
        if (festivalId === undefined) return undefined;

        let pending = this.read.get(festivalId);
        if (pending === undefined) {
            pending = this.festivals.find(festivalId).catch((error: unknown) => {
                this.logger.warn(`director: could not read the festival this show is built around; carrying on without it (${errorText(error)})`);
                return undefined;
            });
            this.read.set(festivalId, pending);
        }
        return await pending;
    }
}
