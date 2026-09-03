import type { AppConfig } from '@maroonedsoftware/appconfig';
import { parseRows } from '@deadair/plugin-sdk';

/**
 * The feeds a bulletin reads, in the order the station reads them.
 *
 * ## Why a list and not a name
 *
 * This replaced `rotation.newsFeed`, a free-text box holding ONE qualified feed id typed by hand
 * from a list the operator had to go and look at. Blank on both installs, which is the answer to
 * what an operator does with a control like that. What it could not express is the thing every
 * multi-feed station actually wants: a running order. A bulletin merged every feed newest first, so
 * a publisher posting twenty times a day crowded out one posting three times, and this station read
 * a technology site's afternoon output as the day's news.
 *
 * ## An empty list is every feed, and a named one is the roster
 *
 * Nothing here is a filter over a default. A station that has not written a list reads everything,
 * newest first, exactly as before; a station that has written one reads THOSE, in THAT order, and a
 * feed nobody listed is not in the bulletin. The alternative — listed feeds first, then the rest —
 * makes adding a feed to a plugin a thing that changes what airs without anybody deciding it should.
 *
 * The console, the news page and the model's own tool still see every feed the station has: this is
 * about what is READ OUT, which is the one place the station is speaking in its own voice.
 */
export const NEWS_FEEDS_KEY = 'rotation.newsFeeds';

/** The column the address lives in. One column, because a row here IS a feed. */
const FEED_COLUMN = 'feed';

/**
 * The roster as ids, in order, or empty for a station that reads everything.
 *
 * Tolerant for `parseRows`' reason and with the same stakes one layer up: a setting somebody has
 * broken by hand answers "no roster", which is a station reading every feed rather than a bulletin
 * that cannot be written. Duplicates are dropped keeping the FIRST, since a feed listed twice is a
 * feed the operator wanted early and then wrote again, not a feed that should take two turns.
 */
export function feedRoster(config: AppConfig): string[] {
    const listed: string[] = [];

    for (const row of parseRows(config.get(NEWS_FEEDS_KEY, ''))) {
        const id = (row[FEED_COLUMN] ?? '').trim();
        if (id.length === 0 || listed.includes(id)) continue;

        listed.push(id);
    }

    return listed;
}
