import { queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { PlayoutChartInput, PlayoutStatus } from '@deadair/sdk';

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

    // The running order moved too, and none of these answers carries it. A skip advances an item's
    // state, a playlist replaces the whole order, and Stop stands the station down while LEAVING the
    // order in place for Start to resume — so the page that draws it has to look again. Without this
    // the console kept the order it had read up to five seconds earlier and drew a stood-down station
    // as though nothing had happened.
    void queryClient.invalidateQueries({ queryKey: queryKeys.director.order() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.director.air() });

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

/**
 * Builds the running order from a published chart and starts airing it.
 *
 * Beside {@link usePlayPlaylist} and through the same `followTransport`, because what these two do
 * to the station is identical however differently the records were chosen.
 */
export function usePlayChart() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ chartId, chartOrder }: { chartId: string; chartOrder?: PlayoutChartInput['chartOrder'] }) =>
            sdk.playout.playAChart({ chartId, ...(chartOrder === undefined ? {} : { chartOrder }) }),
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

/**
 * Start the station again on the running order it was stopped on.
 *
 * Not the same command as putting a playlist on air: that builds a new broadcast and throws away
 * whatever the station was stopped part-way through. This picks that up where it left off, and the
 * API refuses with a 409 when there is nothing left to resume.
 */
export function useStartPlayout() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: () => sdk.playout.startPlayout(),
        onSuccess: status => {
            followTransport(queryClient, status);
        },
    });
}

/**
 * Stands the station down: what is on air stops and the mount goes quiet.
 *
 * It does NOT drop the running order, which is what makes {@link useStartPlayout} able to pick it up
 * where it stopped. Anything drawing an empty-station state has to read the order rather than infer
 * one from the station being off.
 */
export function useStopPlayout() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: () => sdk.playout.stopPlayout(),
        onSuccess: status => {
            followTransport(queryClient, status);
        },
    });
}
