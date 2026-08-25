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
