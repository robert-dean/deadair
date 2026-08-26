import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Pad, PadList, PadState } from '@deadair/sdk';

import { sdk } from './client';
import { queryKeys } from './query.keys';

/**
 * How long the rack stays fresh.
 *
 * The lexicon's reasoning and its number. It moves when an operator moves it, and the one writer
 * that is not this page is the STATION — `last_used_at` is stamped every time a break reaches for a
 * pad — so thirty seconds is how long it takes for "last hit" to catch up without a refresh.
 */
const PADS_STALE_TIME = 30_000;

export const padsOptions = queryOptions({
    queryKey: queryKeys.pads.list(),
    queryFn: () => sdk.render.listPads(),
    staleTime: PADS_STALE_TIME,
});

/** Every sound the station holds, in every state. */
export function usePads() {
    return useQuery(padsOptions);
}

/** Turning one down, or putting it back. The answer is the whole rack, so nothing refetches. */
export function useSetPadState() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, body }: { id: string; body: PadState }) => sdk.render.setPadState(id, body),
        onSuccess: (list: PadList) => queryClient.setQueryData(queryKeys.pads.list(), list),
    });
}

/**
 * Reads the inbox again.
 *
 * Invalidates rather than writing the answer in, unlike every mutation beside it: the scan answers
 * with a COUNT of what it did rather than with the rack, so the list has to be asked for again.
 */
export function useScanPads() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: () => sdk.render.scanThePadInbox(),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.pads.list() }),
    });
}

/**
 * One pad's audio as a blob URL.
 *
 * Through the SDK rather than as a plain `<audio src>`, which is `fetchSegmentAudio`'s reason and
 * survives even though this route is anonymous: the console holds its bearer token in memory, and
 * going through the client keeps every audio fetch on this page the same shape as every other one in
 * the console rather than making this the one exception nobody remembers.
 */
export async function fetchPadAudio(id: string): Promise<string> {
    const result = await sdk.render.getPadAudio(id);

    // A 304 is documented because the conditional-GET middleware can produce one. This caller sends
    // no validator, so there is nothing to match and nothing cached to fall back on.
    if (result.status !== 200) throw new Error(`that pad came back with no audio (${result.status})`);

    return URL.createObjectURL(result.data);
}

export type { Pad, PadList };
