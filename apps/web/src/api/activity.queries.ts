import { infiniteQueryOptions, useInfiniteQuery } from '@tanstack/react-query';
import type { ActivityModule, ActivitySeverity } from '@deadair/sdk';

import { sdk } from './client';
import { queryKeys } from './query.keys';

/**
 * How often the head of the feed is re-read.
 *
 * Slower than the transport's two seconds, deliberately. The transport is a READING that changes on
 * its own between polls; this is a log of things that happened, and the things that produce entries
 * are a record boundary, a render and a gate moving. Polling it at transport speed would spend a
 * three-table union every two seconds to append a line every few minutes.
 */
const ACTIVITY_POLL_MS = 15_000;

/** One screenful and a bit, so the first page fills the list without a scroll fetching immediately. */
const PAGE_SIZE = 50;

export interface ActivityFilter {
    module?: ActivityModule;
    minSeverity?: ActivitySeverity;
}

/**
 * The feed, page by page.
 *
 * Infinite rather than numbered, because the cursor is a keyset: there is no page 2 to ask for, only
 * "what comes after this row". Each filter is its own query rather than a refetch of the same one —
 * a filtered feed is not a stale unfiltered one, and mixing them in the cache would leave a
 * half-filtered list on screen while the new first page loaded.
 *
 * Only the FIRST page polls. `refetchInterval` on an infinite query refetches every page it holds,
 * so an operator who has scrolled back an hour would re-read every page of history on a timer to
 * discover what they already know: those rows are append-only and cannot have changed.
 */
export function activityOptions(filter: ActivityFilter) {
    return infiniteQueryOptions({
        queryKey: queryKeys.activity.feed(filter),
        queryFn: ({ pageParam }) =>
            sdk.activity.readActivity({
                limit: PAGE_SIZE,
                ...(pageParam === undefined ? {} : { before: pageParam }),
                ...(filter.module === undefined ? {} : { module: filter.module }),
                ...(filter.minSeverity === undefined ? {} : { minSeverity: filter.minSeverity }),
            }),
        initialPageParam: undefined as string | undefined,
        // `undefined` is how the API says the feed has been read to its end, and it is also what
        // TanStack reads as "there is no next page", so the two agree without a translation.
        getNextPageParam: page => page.nextBefore,
        refetchInterval: query => (query.state.data?.pages.length === 1 ? ACTIVITY_POLL_MS : false),
        refetchIntervalInBackground: true,
    });
}

/** What the station has been doing, newest first. */
export function useActivity(filter: ActivityFilter, enabled: boolean) {
    return useInfiniteQuery({ ...activityOptions(filter), enabled });
}
