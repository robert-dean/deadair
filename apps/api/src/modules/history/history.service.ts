import { Injectable } from 'injectkit';
import { StationIdentity } from '#modules/shared/station.identity.js';
import { encodeCursor } from '#modules/activity/activity.feed.js';
import { HistoryRepository } from './history.repository.js';
import { toEntry } from './history.page.js';
import { toAsRunEntry } from './as.run.page.js';
import type { AsRunPage, AsRunQuery, HistoryPage, HistoryQuery } from './types/history.types.js';

/** What a page holds when the client does not say. A screenful and a bit, on a list that scrolls. */
const DEFAULT_LIMIT = 50;

/** The as-run log's page when the client does not say: about four hours of a music station. */
const DEFAULT_AS_RUN_LIMIT = 100;

/**
 * What the station has played, newest first.
 *
 * Thin on purpose, exactly as `ActivityService` is: the join is the repository's and the projection
 * is `history.page.ts`'s, so what is left here is the page boundary. It reads one row more than it
 * answers with, which is how a full page is told from the end of the history without counting.
 */
@Injectable()
export class HistoryService {
    constructor(
        private readonly history: HistoryRepository,
        private readonly identity: StationIdentity,
    ) {}

    async readHistory(query: HistoryQuery): Promise<HistoryPage> {
        const limit = query.limit ?? DEFAULT_LIMIT;

        const rows = await this.history.page({
            stationKey: this.identity.stationKey,
            limit,
            ...(query.before === undefined ? {} : { before: query.before }),
        });

        // The extra row is proof there is more, and is not itself answered with: the cursor comes
        // from the last row of THIS page, so the next request starts exactly where this one stopped.
        const page = rows.slice(0, limit);
        const more = rows.length > limit;
        const last = page.at(-1);

        return {
            entries: page.map(toEntry),
            ...(more && last !== undefined ? { nextBefore: encodeCursor({ at: last.airedAt, id: last.id }) } : {}),
        };
    }

    /**
     * The as-run log, newest first: every item that went out, and the gaps and air changes between.
     *
     * The same page boundary as {@link readHistory}, over a union rather than one table; see
     * `HistoryRepository.asRunPage`.
     */
    async readAsRun(query: AsRunQuery): Promise<AsRunPage> {
        const limit = query.limit ?? DEFAULT_AS_RUN_LIMIT;

        const rows = await this.history.asRunPage({
            stationKey: this.identity.stationKey,
            limit,
            ...(query.before === undefined ? {} : { before: query.before }),
            ...(query.until === undefined ? {} : { until: query.until }),
        });

        const page = rows.slice(0, limit);
        const more = rows.length > limit;
        const last = page.at(-1);

        return {
            entries: page.map(toAsRunEntry),
            ...(more && last !== undefined ? { nextBefore: encodeCursor({ at: last.at, id: last.id }) } : {}),
        };
    }
}
