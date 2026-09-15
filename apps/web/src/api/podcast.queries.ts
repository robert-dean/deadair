import { queryOptions, useQuery } from '@tanstack/react-query';

import { sdk } from './client';
import { queryKeys } from './query.keys';

/**
 * How long the list of shows stays fresh.
 *
 * Long, for `news.queries.ts`' reason: which shows the station carries changes when an operator edits
 * a subscription, not on its own, and asking reads every subscribed feed.
 */
const SHOWS_STALE_TIME = 5 * 60_000;

export const podcastShowsOptions = queryOptions({
    queryKey: queryKeys.podcasts.shows(),
    queryFn: () => sdk.podcasts.listShows(),
    staleTime: SHOWS_STALE_TIME,
});

/** Every show the installed podcast plugins carry. */
export function usePodcastShows() {
    return useQuery(podcastShowsOptions);
}
