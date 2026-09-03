import { queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
    AddStationSegmentInput,
    AddStationTrackInput,
    ExtendStationInput,
    HoldStationInput,
    MoveStationItemInput,
    PutOnAirInput,
    ReplanStationInput,
    SetStationAirInput,
    SetStationHostInput,
    StationOrder,
} from '@deadair/sdk';

import { sdk } from './client';
import { queryKeys } from './query.keys';

/**
 * How often what-is-on-air is re-read.
 *
 * It polls for the reason the transport does: items move through their states as the player
 * consumes them, which begins nowhere near this browser. Slower than the transport's two seconds on
 * purpose — an item changes state once a track, not once a reconcile tick, so reading it faster
 * would only re-read a reading that has not been retaken.
 */
const AIR_POLL_MS = 5_000;

export const stationAirOptions = queryOptions({
    queryKey: queryKeys.director.air(),
    queryFn: () => sdk.director.getStationAir(),
    refetchInterval: AIR_POLL_MS,
    // Keep polling with the tab in the background, for the reason the transport does: an operator
    // who alt-tabs away still wants the truth when they come back rather than a frozen reading.
    refetchIntervalInBackground: true,
});

/**
 * What is on air, polled only while there is a session to poll with.
 *
 * `enabled` rather than a conditional hook: an unauthenticated poll is a 401 every five seconds for
 * as long as the login page is open.
 */
export function useStationAir(enabled = true) {
    return useQuery({ ...stationAirOptions, enabled });
}

/**
 * The live running order: what is on air, item by item.
 *
 * Polled like the air reading, and for the same reason.
 */
export const stationOrderOptions = queryOptions({
    queryKey: queryKeys.director.order(),
    queryFn: () => sdk.director.getTheRunningOrder(),
    refetchInterval: AIR_POLL_MS,
});

export function useStationOrder() {
    return useQuery(stationOrderOptions);
}

/**
 * When to look at the running order again after asking for it to be extended, in milliseconds from
 * the moment the request came back.
 *
 * A refill is a job rather than a write: the route queues `director.extend_lineup` and returns 202,
 * and the tracks appear once the job has walked the catalog. There is nothing to write into the
 * cache, so the console looks again instead. Three reads over eight seconds, then it stops: a refill
 * that has not landed by then is a job worth telling the operator about rather than one worth
 * polling forever.
 */
const EXTEND_FOLLOW_UP_MS = [1_500, 4_000, 8_000];

/** Pending follow-ups, with no id to key on because there is one running order. */
let extendFollowUps: ReturnType<typeof setTimeout>[] = [];

/**
 * Keep looking at the running order for a moment, because the growth is on its way.
 *
 * Exported for tests; `useExtendOrder` is the only caller.
 */
export function followStationExtend(queryClient: QueryClient): void {
    for (const timer of extendFollowUps) clearTimeout(timer);

    extendFollowUps = EXTEND_FOLLOW_UP_MS.map(delay =>
        setTimeout(() => {
            void queryClient.refetchQueries({ queryKey: queryKeys.director.order() });
            void queryClient.invalidateQueries({ queryKey: queryKeys.director.air() });
        }, delay),
    );
}

/**
 * Puts the station on air, building the running order from a playlist.
 *
 * The playlist is READ rather than copied, so nothing here has to worry about a stored list going
 * stale or being written into: there is no stored list.
 */
export function usePutStationOnAir() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (input: PutOnAirInput) => sdk.director.putTheStationOnAir(input),
        onSuccess: air => {
            queryClient.setQueryData(queryKeys.director.air(), air);
            void queryClient.invalidateQueries({ queryKey: queryKeys.director.order() });
            // The transport is about to start handing this out, and it polls on its own clock.
            void queryClient.invalidateQueries({ queryKey: queryKeys.playout.status() });
        },
    });
}

/**
 * Every edit to the running order answers with the order it produced.
 *
 * So each of these writes that answer straight into the cache rather than invalidating and
 * re-reading: the director applied the edit before it replied, and a re-read would race the
 * transport's own next move.
 */
function orderMutation<TInput>(queryClient: QueryClient, run: (input: TInput) => Promise<StationOrder>) {
    return {
        mutationFn: run,
        onSuccess: (order: StationOrder) => {
            queryClient.setQueryData(queryKeys.director.order(), order);
            void queryClient.invalidateQueries({ queryKey: queryKeys.director.air() });
        },
    };
}

/** Shuffles everything the player is not already holding. What it holds keeps its place. */
export function useShuffleOrder() {
    const queryClient = useQueryClient();
    return useMutation(orderMutation<void>(queryClient, () => sdk.director.shuffleTheRunningOrder()));
}

export function useMoveOrderItem() {
    const queryClient = useQueryClient();
    return useMutation(
        orderMutation<{ itemId: string } & MoveStationItemInput>(queryClient, ({ itemId, ...body }) =>
            sdk.director.moveARunningOrderItem(itemId, body),
        ),
    );
}

export function useRemoveOrderItem() {
    const queryClient = useQueryClient();
    return useMutation(orderMutation<string>(queryClient, itemId => sdk.director.removeARunningOrderItem(itemId)));
}

/**
 * Changes who is presenting the broadcast that is on air.
 *
 * An order mutation like the four above, because that is what it answers with: the running order
 * carries the host and the label it resolves to, so the page redraws from the reply rather than
 * re-reading. The breaks it costs are written again behind this, on the station's own clock.
 */
export function useRecastStation() {
    const queryClient = useQueryClient();
    return useMutation(orderMutation<SetStationHostInput>(queryClient, body => sdk.director.recastTheBroadcast(body)));
}

export function useAddOrderSegment() {
    const queryClient = useQueryClient();
    return useMutation(orderMutation<AddStationSegmentInput>(queryClient, body => sdk.director.addASegmentToTheRunningOrder(body)));
}

/**
 * Puts a catalog record into the running order at a position.
 *
 * Undo's other half: {@link useRemoveOrderItem} takes a track out of the order entirely, and this
 * is the only way one can be put back. An order mutation like the others, on the same reasoning —
 * the director applied the edit before it replied, so the reply is what the table redraws from.
 */
export function useAddOrderTrack() {
    const queryClient = useQueryClient();
    return useMutation(orderMutation<AddStationTrackInput>(queryClient, body => sdk.director.addARecordToTheRunningOrder(body)));
}

/** Queues a refill of what is on air. Returns as soon as it is queued; the tracks land later. */
export function useExtendOrder() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (input: ExtendStationInput) => sdk.director.extendTheRunningOrder(input),
        onSuccess: () => {
            followStationExtend(queryClient);
        },
    });
}

/**
 * Throws away everything the player is not already holding and has the station programme it again.
 *
 * Queued like a refill and slower than one, because the whole set is generated BEFORE anything is
 * dropped: that is what keeps the old tail playing across the swap. So the follow-ups below are a
 * nudge rather than the mechanism — what actually shows the new hour is the running order's own
 * poll, which a replan may well outlast.
 */
export function useReplanOrder() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (input: ReplanStationInput) => sdk.director.replanTheRunningOrder(input),
        onSuccess: () => {
            followStationExtend(queryClient);
        },
    });
}

/**
 * Change what puts the station on air: only while somebody is listening, or whenever there is a
 * programme.
 *
 * The answer carries the mode that was just written, so the console renders the operator's own
 * choice rather than the one the config still reports for the length of this request.
 */
/**
 * Hold the station against the schedule, or release it.
 *
 * One hook for both, because they are one decision with two answers and a console drawing them as
 * separate mutations would need two pending states for one control. `undefined` releases.
 *
 * The running order is invalidated as well as the air reading, which is not belt and braces: the
 * hold rides the running order, so a console reading the order after this without refetching would
 * be holding a document the API has already moved past.
 */
export function useHoldAgainstSchedule() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (input: HoldStationInput | undefined) =>
            input === undefined ? sdk.director.releaseTheStationToTheSchedule() : sdk.director.holdTheStationAgainstTheSchedule(input),
        onSuccess: air => {
            queryClient.setQueryData(queryKeys.director.air(), air);
            void queryClient.invalidateQueries({ queryKey: queryKeys.director.order() });
        },
    });
}

export function useSetAirMode() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (input: SetStationAirInput) => sdk.director.setTheAirMode(input),
        onSuccess: air => {
            queryClient.setQueryData(queryKeys.director.air(), air);
            // The gate decides whether the station is actually producing audio, and the transport
            // reads it on its own clock.
            void queryClient.invalidateQueries({ queryKey: queryKeys.playout.status() });
        },
    });
}
