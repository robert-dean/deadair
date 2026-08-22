import { infiniteQueryOptions, queryOptions, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { ScriptOutcome } from '@deadair/sdk';

import { sdk } from './client';
import { queryKeys } from './query.keys';

/**
 * How often the head of the history is re-read.
 *
 * Slower than the activity feed's fifteen seconds, because a row lands here only when the station
 * writes a break, which is a few times an hour on a talkative station. Fast enough that an operator
 * tuning a persona sees the next break arrive without reaching for refresh.
 */
const SCRIPTS_POLL_MS = 30_000;

/** One screenful and a bit, matching the API's own default. */
const PAGE_SIZE = 50;

export interface ScriptFilter {
    kind?: string;
    writer?: string;
    outcome?: ScriptOutcome;
    /** Every attempt made for one break, which is where a link off the running order lands. */
    segmentId?: string;
    /**
     * Everything ONE character has said, stamped on every attempt including the declined ones — so
     * a persona whose model breaks are all being refused reads as exactly that rather than as a
     * character nothing has asked to write.
     */
    personaKey?: string;
}

/**
 * What the station has written, page by page.
 *
 * Infinite rather than numbered, because the cursor is a keyset: there is no page 2 to ask for,
 * only what comes after this row.
 *
 * Only the FIRST page polls, exactly as the activity feed does. `refetchInterval` on an infinite
 * query refetches every page it holds, so an operator who has scrolled back would re-read hours of
 * append-only history to learn what they already know.
 */
export function scriptHistoryOptions(filter: ScriptFilter) {
    return infiniteQueryOptions({
        queryKey: queryKeys.scripts.history(filter),
        queryFn: ({ pageParam }) =>
            sdk.render.readScriptHistory({
                limit: PAGE_SIZE,
                ...(pageParam === undefined ? {} : { before: pageParam }),
                ...(filter.kind === undefined ? {} : { kind: filter.kind }),
                ...(filter.writer === undefined ? {} : { writer: filter.writer }),
                ...(filter.outcome === undefined ? {} : { outcome: filter.outcome }),
                ...(filter.segmentId === undefined ? {} : { segmentId: filter.segmentId }),
                ...(filter.personaKey === undefined ? {} : { personaKey: filter.personaKey }),
            }),
        initialPageParam: undefined as string | undefined,
        // `undefined` is how the API says the history has been read to its end, and it is also what
        // TanStack reads as "there is no next page", so the two agree without a translation.
        getNextPageParam: page => page.nextBefore,
        refetchInterval: query => (query.state.data?.pages.length === 1 ? SCRIPTS_POLL_MS : false),
        refetchIntervalInBackground: true,
    });
}

/** Everything the station has written, newest first. */
export function useScriptHistory(filter: ScriptFilter, enabled: boolean) {
    return useInfiniteQuery({ ...scriptHistoryOptions(filter), enabled });
}

/**
 * How long the roster's counts stay fresh.
 *
 * Longer than the history's poll and not polled at all: this is a shape rather than a feed, and it
 * moves by one when a break is written. An operator watching a character's record change live is
 * reading the history itself, which is a click away and does poll.
 */
const SUMMARY_STALE_TIME = 60_000;

/** A day, matching what the API counts when nobody says otherwise. */
export const SUMMARY_HOURS = 24;

/**
 * What each character has attempted lately, counted by outcome.
 *
 * One call for the whole roster rather than one per card, because the question is asked about a list
 * and a page of nineteen characters would otherwise open with nineteen requests.
 */
export const scriptSummaryOptions = queryOptions({
    queryKey: queryKeys.scripts.summary(SUMMARY_HOURS),
    queryFn: () => sdk.render.readScriptSummary({ hours: SUMMARY_HOURS }),
    staleTime: SUMMARY_STALE_TIME,
});

export function useScriptSummary() {
    return useQuery(scriptSummaryOptions);
}
