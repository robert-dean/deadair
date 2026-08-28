import { queryOptions, useQuery } from '@tanstack/react-query';

import { sdk } from './client';
import { queryKeys } from './query.keys';

/**
 * How often the station is asked what needs somebody.
 *
 * Fifteen seconds, matching the activity feed rather than the transport. What is on the other end is
 * a composition across five services — a silence diagnosis, the running order, two catalog counts and
 * the plugin list — and none of the things it reports appears or clears within a second. The
 * transport strip is what moves at transport speed.
 *
 * In the background too, because the nav badge is on every page and an operator who left the console
 * open on the catalog should still see a plugin fall over.
 */
const ATTENTION_POLL_MS = 15_000;

export const stationAttentionOptions = queryOptions({
    queryKey: queryKeys.station.attention(),
    queryFn: () => sdk.station.readStationAttention(),
    refetchInterval: ATTENTION_POLL_MS,
    refetchIntervalInBackground: true,
    staleTime: ATTENTION_POLL_MS,
});

/**
 * Everything wrong or waiting, worst first.
 *
 * One query for two surfaces — the home page's list and the counts on the nav — so the badge and the
 * list cannot come to different conclusions about the same station. `enabled` is how the shell keeps
 * it from firing on the login page, exactly as the playout poll does.
 */
export function useStationAttention(enabled: boolean) {
    return useQuery({ ...stationAttentionOptions, enabled });
}

/**
 * How often the machinery is re-read.
 *
 * Thirty seconds, slower than the attention list because what it carries moves slower still: a
 * heartbeat that is late is late for minutes, and a library gets measured over hours. It does NOT
 * poll in the background, unlike the attention query beside it — nothing here drives a badge, so a
 * reading nobody is looking at is a request nobody asked for.
 */
const CHECKUP_POLL_MS = 30_000;

export const stationCheckupOptions = queryOptions({
    queryKey: queryKeys.station.checkup(),
    queryFn: () => sdk.station.readStationCheckup(),
    refetchInterval: CHECKUP_POLL_MS,
    staleTime: CHECKUP_POLL_MS,
});

/** The loops the station runs, and how much of the library it has looked at. */
export function useStationCheckup() {
    return useQuery(stationCheckupOptions);
}

/**
 * How often the list of decisions is re-read.
 *
 * It is not polled at all, and that is the difference from everything above. The attention list and
 * the check-up are readings of a station that is changing under them; this is a scan of files that
 * were written when the work happened, opened by somebody looking into something specific. Polling
 * it would re-read the whole kept window on a timer to discover rows that cannot change.
 */
const TRACES_STALE_MS = 30_000;

export interface TracesFilter {
    kind?: string;
    failedOnly?: boolean;
}

/**
 * What the station did, decision by decision, newest first.
 *
 * Not an infinite query, unlike the activity feed it sits beside. The feed pages with a keyset
 * because rows arrive at its head continuously and there is no page 2 to ask for; this reads a
 * bounded window and slices it, and the answer says how much of it there was.
 */
export function useTraces(filter: TracesFilter) {
    return useQuery({
        queryKey: queryKeys.station.traces(filter),
        queryFn: () =>
            sdk.station.readTraces({
                ...(filter.kind === undefined ? {} : { kind: filter.kind }),
                ...(filter.failedOnly === true ? { failedOnly: true } : {}),
            }),
        staleTime: TRACES_STALE_MS,
    });
}

/**
 * One decision: every call it made, and the decisions on either side of it.
 *
 * `enabled` is how the drawer keeps this from firing before an operator has picked a row, matching
 * how every other conditional read in this file is gated.
 */
export function useTrace(id: string | undefined) {
    return useQuery({
        queryKey: queryKeys.station.trace(id ?? ''),
        queryFn: () => sdk.station.readTrace(id!),
        enabled: id !== undefined,
        staleTime: TRACES_STALE_MS,
    });
}
