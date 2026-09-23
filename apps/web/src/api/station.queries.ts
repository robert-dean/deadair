import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LogLevel } from '@deadair/sdk';

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
 * How long the release notes are kept before they are asked for again.
 *
 * Five minutes. The build's own notes cannot change while the station runs, since a different
 * changelog is a different image, but what it has heard about NEWER releases can: the station asks
 * GitHub every few hours, and the console should not show an old answer for longer than it takes an
 * operator to come back to the page.
 */
const RELEASES_STALE_MS = 5 * 60_000;

/**
 * How often the header re-reads it, in the background.
 *
 * Thirty minutes. The station itself asks GitHub at most every six hours, so polling faster would be
 * re-reading an answer that has not moved, and the whole payload is every release's notes.
 */
const RELEASES_POLL_MS = 30 * 60_000;

export const stationReleasesOptions = queryOptions({
    queryKey: queryKeys.station.releases(),
    queryFn: () => sdk.station.readStationReleases(),
    staleTime: RELEASES_STALE_MS,
});

/** The releases this build contains and what each one changed, newest first. */
export function useStationReleases() {
    return useQuery(stationReleasesOptions);
}

/**
 * The same reading, kept fresh from the header on every page.
 *
 * One query key for both, so the header's notice and What's new cannot disagree about whether there
 * is anything newer. `enabled` is how the shell keeps it off the login page, as the attention poll
 * does.
 */
export function useStationReleasesPoll(enabled: boolean) {
    return useQuery({ ...stationReleasesOptions, enabled, refetchInterval: RELEASES_POLL_MS, refetchIntervalInBackground: true });
}

/**
 * Asks the station to check GitHub now. Needs `platform.manage`, so a non-admin gets a 403.
 *
 * The answer is the whole reading, written straight into the cache rather than invalidated: it is
 * already what a refetch would return, and writing it is what updates What's new, the header notice
 * and the Build line at once.
 */
export function useCheckStationReleases() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: () => sdk.station.checkStationReleases(),
        onSuccess: releases => {
            queryClient.setQueryData(queryKeys.station.releases(), releases);
        },
    });
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

/**
 * How long the list of logs stays fresh.
 *
 * Slower than the tail below it, because what moves on this reading is a size and a mtime rather
 * than the lines themselves — and the one thing on it that genuinely appears out of nowhere, a
 * stream log the first time the audio chain runs, is not a thing anybody is watching for.
 */
const LOG_SOURCES_STALE_MS = 30_000;

/**
 * How long a fetched tail stays fresh.
 *
 * The same three seconds `PLUGIN_LOGS_STALE_TIME` uses, for the reason that constant gives: unlike a
 * record, which moves only when an operator moves it, a log fills continuously while the process
 * writing it runs, so anything near the 30 seconds above would show a tail tens of seconds behind.
 * Not the same constant, deliberately — these are two log stores with two reasons to change, and
 * sharing a number would make one of them look like a consequence of the other.
 */
const LOG_STALE_MS = 3_000;

export const logSourcesOptions = queryOptions({
    queryKey: queryKeys.station.logSources(),
    queryFn: () => sdk.station.listLogs(),
    staleTime: LOG_SOURCES_STALE_MS,
});

/** Which logs this install has, present or not. */
export function useLogSources() {
    return useQuery(logSourcesOptions);
}

/**
 * A tail of one log, newest first.
 *
 * Not polled, like everything else on Check-up that is a file rather than a reading: an operator
 * looking into something wants the tail they asked for to hold still while they read it, and the
 * Refresh button is how they ask for the next one. `enabled` gates it until a source is picked,
 * matching `useTrace` above.
 */
export function useLog(id: string | undefined, level: LogLevel | undefined) {
    return useQuery({
        queryKey: queryKeys.station.log(id ?? '', level),
        queryFn: () => sdk.station.readLog(id!, level === undefined ? {} : { level }),
        enabled: id !== undefined,
        staleTime: LOG_STALE_MS,
    });
}
