import { queryOptions, useQuery } from '@tanstack/react-query';

import { sdk } from './client';
import { queryKeys } from './query.keys';

/**
 * How long the feed list stays fresh.
 *
 * Long: which feeds exist changes when an operator edits a plugin's config, not on its own. The
 * stories underneath move far more often and carry their own, shorter, life.
 */
const FEEDS_STALE_TIME = 5 * 60_000;

/**
 * How long a page of stories stays fresh.
 *
 * A minute, and no polling. A newsroom publishes on its own clock and the plugin behind this reads
 * an upstream feed on a rate budget shared with everything else that plugin does, so an interval
 * here would spend it redrawing the same headlines. What this page answers is "what does the
 * station think the news is", which is a question somebody asks and then reads.
 */
const STORIES_STALE_TIME = 60_000;

export const newsFeedsOptions = queryOptions({
    queryKey: queryKeys.news.feeds(),
    queryFn: () => sdk.news.listFeeds(),
    staleTime: FEEDS_STALE_TIME,
});

/** Every feed the installed plugins offer, with whatever the operator called each one. */
export function useNewsFeeds() {
    return useQuery(newsFeedsOptions);
}

/**
 * Headlines only, always.
 *
 * This page draws a feed name, the categories, the moment and the publisher's own teaser, and links
 * out for the rest. It has never drawn `content`, and `content` is the single most expensive thing
 * the station can be asked for: a story is read from the publisher's own page, one page at a time.
 * Measured before this flag existed, `/api/news` took 3.2s on the live station where every other
 * call the page makes returns inside 30ms, and all of it bought article bodies that were parsed,
 * sent, and dropped on the floor here.
 *
 * A bulletin and the model's news tool do NOT pass it, because for them the story is the point.
 */
export function newsStoriesOptions(feedId?: string) {
    return queryOptions({
        queryKey: queryKeys.news.stories(feedId),
        queryFn: () => sdk.news.readNews({ headlinesOnly: true, ...(feedId === undefined ? {} : { feedId }) }),
        staleTime: STORIES_STALE_TIME,
    });
}

/** The stories, newest first. Absent `feedId` reads every feed the station has. */
export function useNews(feedId?: string) {
    return useQuery(newsStoriesOptions(feedId));
}
