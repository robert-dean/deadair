import { queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { EditLineupInput, ExtendLineupInput, ImportLineupInput, Lineup, MoveLineupItemInput, PutOnAirInput } from '@deadair/sdk';

import { sdk } from './client';
import { queryKeys } from './query.keys';

/**
 * How long a lineup read stays fresh.
 *
 * Short, because a lineup has two writers the console is not one of: the extend job appends to it,
 * and the director commits from the head of it as tracks air. Every edit here writes its own answer
 * into the cache, so this only covers the drift nothing in this browser caused.
 */
const LINEUP_STALE_TIME = 10_000;

/**
 * How often what-is-on-air is re-read.
 *
 * It polls for the reason the transport does: the cursor advances when a track ends, which begins
 * nowhere near this browser. Slower than the transport's two seconds on purpose — the cursor moves
 * once a track, not once a reconcile tick, so reading it faster would only re-read a reading that
 * has not been retaken.
 */
const AIR_POLL_MS = 5_000;

export const lineupsListOptions = queryOptions({
    queryKey: queryKeys.director.lineups(),
    queryFn: () => sdk.director.listLineups(),
    staleTime: LINEUP_STALE_TIME,
});

export function lineupOptions(lineupId: string) {
    return queryOptions({
        queryKey: queryKeys.director.lineup(lineupId),
        queryFn: () => sdk.director.getALineup(lineupId),
        staleTime: LINEUP_STALE_TIME,
    });
}

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
 * Take the lineup an edit produced, and let the list agree with it.
 *
 * Every mutating route answers with the whole lineup, so the console never has to re-read what it
 * just changed. The summaries are a different read and hold a stale `itemCount` and `revision`
 * after this, so they are invalidated rather than patched: guessing at a summary from a detail is
 * how the two drift apart.
 */
function writeLineup(queryClient: QueryClient, lineup: Lineup): void {
    queryClient.setQueryData(queryKeys.director.lineup(lineup.id), lineup);
    void queryClient.invalidateQueries({ queryKey: queryKeys.director.lineups() });
}

/**
 * When to look at a lineup again after asking for it to be extended, in milliseconds from the
 * API's answer.
 *
 * Extend is the one action here that answers before it has done anything: it queues
 * `director.extend_lineup` and returns 202, and the tracks appear once the job has walked the
 * catalog. There is nothing to write into the cache, so the console looks again instead. Three
 * reads over eight seconds, then it stops: a refill that has not landed by then is a job worth
 * telling the operator about rather than one worth polling forever.
 */
const EXTEND_FOLLOW_UP_MS = [1_500, 4_000, 8_000];

/** Pending follow-ups per lineup, so extending twice replaces the first schedule rather than stacking on it. */
const extendFollowUps = new Map<string, ReturnType<typeof setTimeout>[]>();

/**
 * Keep looking at a lineup for a moment, because the growth is on its way.
 *
 * Exported for tests; `useExtendLineup` is the only caller.
 */
export function followExtend(queryClient: QueryClient, lineupId: string): void {
    for (const timer of extendFollowUps.get(lineupId) ?? []) clearTimeout(timer);

    extendFollowUps.set(
        lineupId,
        EXTEND_FOLLOW_UP_MS.map(delay =>
            setTimeout(() => {
                void queryClient.refetchQueries({ queryKey: queryKeys.director.lineup(lineupId) });
                void queryClient.invalidateQueries({ queryKey: queryKeys.director.lineups() });
            }, delay),
        ),
    );
}

/** Builds a lineup from a provider playlist. Importing is not airing: the new lineup goes nowhere until it is put on. */
export function useImportLineup() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (input: ImportLineupInput) => sdk.director.importALineup(input),
        onSuccess: lineup => {
            writeLineup(queryClient, lineup);
        },
    });
}

/**
 * Puts a lineup on air from the top.
 *
 * Both the air reading and the lineup are rewritten: the lineup's cursor is the CURRENT broadcast's,
 * so a lineup that read zero a moment ago is now the one being committed from.
 */
export function usePutLineupOnAir() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (input: PutOnAirInput) => sdk.director.putALineupOnAir(input),
        onSuccess: (air, input) => {
            queryClient.setQueryData(queryKeys.director.air(), air);
            void queryClient.invalidateQueries({ queryKey: queryKeys.director.lineup(input.lineupId) });
            // The transport is about to start handing this out, and it polls on its own clock.
            void queryClient.invalidateQueries({ queryKey: queryKeys.playout.status() });
        },
    });
}

/** Queues a refill. The lineup grows a few seconds later; see {@link followExtend}. */
export function useExtendLineup() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ lineupId, count }: { lineupId: string } & ExtendLineupInput) =>
            sdk.director.extendALineup(lineupId, count === undefined ? {} : { count }),
        onSuccess: (_answer, { lineupId }) => {
            followExtend(queryClient, lineupId);
        },
    });
}

/** Shuffles everything not yet committed. What the player already holds keeps its place. */
export function useShuffleLineup() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ lineupId, revision }: { lineupId: string } & EditLineupInput) =>
            sdk.director.shuffleALineup(lineupId, revision === undefined ? {} : { revision }),
        onSuccess: lineup => {
            writeLineup(queryClient, lineup);
        },
    });
}

/** Drops a line that has not been committed yet. */
export function useRemoveLineupItem() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ lineupId, itemId, revision }: { lineupId: string; itemId: string } & EditLineupInput) =>
            sdk.director.removeALineupItem(lineupId, itemId, revision === undefined ? undefined : { revision }),
        onSuccess: lineup => {
            writeLineup(queryClient, lineup);
        },
    });
}

/**
 * Moves a line within a lineup.
 *
 * Nothing calls this yet: the console draws the order but does not offer to reorder it. It ships
 * with the rest of the layer so that adding the interaction is UI work against a seam that already
 * writes the cache and reports conflicts the same way every other edit does.
 */
export function useMoveLineupItem() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ lineupId, itemId, ...body }: { lineupId: string; itemId: string } & MoveLineupItemInput) =>
            sdk.director.moveALineupItem(lineupId, itemId, body),
        onSuccess: lineup => {
            writeLineup(queryClient, lineup);
        },
    });
}

/**
 * Deletes a lineup.
 *
 * The API answers 409 while it is on air rather than taking the station off it, so the failure this
 * can produce is one the caller is expected to show verbatim.
 */
export function useDeleteLineup() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (lineupId: string) => sdk.director.deleteALineup(lineupId),
        onSuccess: (_answer, lineupId) => {
            queryClient.removeQueries({ queryKey: queryKeys.director.lineup(lineupId) });
            void queryClient.invalidateQueries({ queryKey: queryKeys.director.lineups() });
        },
    });
}
