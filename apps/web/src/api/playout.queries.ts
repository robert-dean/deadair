import { queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { PlayoutStatus } from '@deadair/sdk';

import { sdk } from './client';
import { queryKeys } from './query.keys';

/**
 * How often the transport is re-read.
 *
 * Unlike every other query here, this one polls. The station moves on its own:
 * a track ends, the next one starts, the running order drains — none of which
 * begins with an action in this browser, so there is nothing to invalidate on.
 * Two seconds matches the interval the API's own reconcile loop runs at, so
 * polling faster would only re-read a reading that has not been retaken.
 */
const PLAYOUT_POLL_MS = 2_000;

export const playoutStatusOptions = queryOptions({
    queryKey: queryKeys.playout.status(),
    queryFn: () => sdk.playout.getPlayoutStatus(),
    refetchInterval: PLAYOUT_POLL_MS,
    // Keep polling with the tab in the background: this is a broadcast console, and
    // an operator who alt-tabs away still wants the truth when they come back rather
    // than a frozen reading that resumes from wherever it stopped.
    refetchIntervalInBackground: true,
});

/**
 * The transport reading, polled only while there is a session to poll with.
 *
 * `enabled` rather than a conditional hook: an unauthenticated poll is a 401
 * every two seconds for as long as the login page is open.
 */
export function usePlayoutStatus(enabled: boolean) {
    return useQuery({ ...playoutStatusOptions, enabled });
}

/**
 * Every transport call answers with the status it produced, so the poll never has
 * to race the mutation to show the result.
 */
function writeStatus(queryClient: QueryClient, status: PlayoutStatus): void {
    queryClient.setQueryData(queryKeys.playout.status(), status);
}

/** Loads a plugin playlist into the running order and starts airing it. */
export function usePlayPlaylist() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ pluginId, playlistId }: { pluginId: string; playlistId: string }) => sdk.playout.playAPlaylist({ pluginId, playlistId }),
        onSuccess: status => {
            writeStatus(queryClient, status);
        },
    });
}

/** Ends the item on air. */
export function useSkipCurrent() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: () => sdk.playout.skipTheCurrentItem(),
        onSuccess: status => {
            writeStatus(queryClient, status);
        },
    });
}

/** Drops the running order. What is on air finishes; the mount falls back to the local bed. */
export function useStopPlayout() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: () => sdk.playout.stopPlayout(),
        onSuccess: status => {
            writeStatus(queryClient, status);
        },
    });
}
