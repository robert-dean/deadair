import { Injectable } from 'injectkit';
import { ActivityRepository } from './activity.repository.js';
import { encodeCursor, toEntry } from './activity.feed.js';
import type { ActivityPage, ActivityQuery } from './types/activity.types.js';

/** What a page holds when the console does not say. A screenful and a bit, on a list that scrolls. */
const DEFAULT_LIMIT = 50;

/**
 * What the station has been doing, as one time-ordered list.
 *
 * Thin on purpose: the union is the repository's and the sentences are `activity.feed.ts`'s, so what
 * is left here is the page boundary. It reads one row more than it answers with, which is how a full
 * page is told from the end of the feed without counting three tables.
 */
@Injectable()
export class ActivityService {
    constructor(private readonly activity: ActivityRepository) {}

    async readActivity(query: ActivityQuery): Promise<ActivityPage> {
        const limit = query.limit ?? DEFAULT_LIMIT;

        const rows = await this.activity.page({
            limit,
            ...(query.before === undefined ? {} : { before: query.before }),
            ...(query.module === undefined ? {} : { module: query.module }),
            ...(query.minSeverity === undefined ? {} : { minSeverity: query.minSeverity }),
        });

        // The extra row is proof there is more, and is not itself answered with: the cursor comes
        // from the last row of THIS page, so the next request starts exactly where this one stopped.
        const page = rows.slice(0, limit);
        const more = rows.length > limit;
        const last = page.at(-1);

        return {
            entries: page.map(toEntry),
            ...(more && last !== undefined ? { nextBefore: encodeCursor(last) } : {}),
        };
    }
}
