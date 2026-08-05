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
 * When to look again after driving the transport, in milliseconds from the
 * mutation's own answer.
 *
 * A transport action is the one moment the station moves BECAUSE of this browser,
 * and the moving takes longer than the request: the API waits out the player's
 * boundary within a budget, and Liquidsoap's `aired` notify can land just after
 * the response goes out. Waiting a full poll interval to find out is most of what
 * makes a skip feel like it did not take.
 *
 * Three reads over two and a half seconds, then the ordinary poll resumes. The
 * poll itself stays at {@link PLAYOUT_POLL_MS}: it matches the API's reconcile
 * tick, so running it faster all the time would only re-read a reading that has
 * not been retaken.
 */
const FOLLOW_UP_MS = [400, 1_000, 2_500];

/** Pending follow-ups, so a second action replaces the first one's schedule rather than stacking on it. */
let followUps: ReturnType<typeof setTimeout>[] = [];

/**
 * Every transport call answers with the status it produced, so the poll never has
 * to race the mutation to show the result.
 */
function writeStatus(queryClient: QueryClient, status: PlayoutStatus): void {
    queryClient.setQueryData(queryKeys.playout.status(), status);
}

/**
 * Take the status the action produced, then keep looking for a moment.
 *
 * Exported for tests; every transport mutation below goes through it.
 */
export function followTransport(queryClient: QueryClient, status: PlayoutStatus): void {
    writeStatus(queryClient, status);

    for (const timer of followUps.splice(0)) clearTimeout(timer);
    followUps = FOLLOW_UP_MS.map(delay =>
        setTimeout(() => {
            void queryClient.refetchQueries({ queryKey: queryKeys.playout.status() });
        }, delay),
    );
}

/** Loads a plugin playlist into the running order and starts airing it. */
export function usePlayPlaylist() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ pluginId, playlistId }: { pluginId: string; playlistId: string }) => sdk.playout.playAPlaylist({ pluginId, playlistId }),
        onSuccess: status => {
            followTransport(queryClient, status);
        },
    });
}

/** Ends the item on air. */
export function useSkipCurrent() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: () => sdk.playout.skipTheCurrentItem(),
        onSuccess: status => {
            followTransport(queryClient, status);
        },
    });
}

/** Drops the running order. What is on air finishes; the mount falls back to the local bed. */
export function useStopPlayout() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: () => sdk.playout.stopPlayout(),
        onSuccess: status => {
            followTransport(queryClient, status);
        },
    });
}
