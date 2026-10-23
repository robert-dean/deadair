import { infiniteQueryOptions, useInfiniteQuery } from '@tanstack/react-query';
import type { DateTime } from 'luxon';

import { sdk } from './client';
import { queryKeys } from './query.keys';

/** How often the head of the log is re-read: a line lands about every three minutes, so the feed's own pace is plenty. */
const AS_RUN_POLL_MS = 15_000;

/** About four hours of a music station, so the first page is an evening rather than a moment. */
const PAGE_SIZE = 100;

/**
 * The as-run log, page by page, newest first, optionally read back from a moment.
 *
 * `activityOptions`' shape and for its reasons: a keyset has no page 2, only "after this row", and
 * only the first page polls. Reading from a moment is its own query, since it is a different log to
 * scroll, and it does not poll: its head is in the past and cannot move.
 */
export function asRunOptions(until?: DateTime) {
    return infiniteQueryOptions({
        queryKey: queryKeys.history.asRun(until?.toISO() ?? undefined),
        queryFn: ({ pageParam }) =>
            sdk.history.readAsRunLog({
                limit: PAGE_SIZE,
                ...(pageParam === undefined ? (until === undefined ? {} : { until }) : { before: pageParam }),
            }),
        initialPageParam: undefined as string | undefined,
        getNextPageParam: page => page.nextBefore,
        refetchInterval: query => (until === undefined && query.state.data?.pages.length === 1 ? AS_RUN_POLL_MS : false),
        refetchIntervalInBackground: true,
    });
}

/** What actually went out, newest first. */
export function useAsRun(until?: DateTime) {
    return useInfiniteQuery(asRunOptions(until));
}
