import { queryOptions, useQuery } from '@tanstack/react-query';
import type { BreakKindInput, BreakKindList } from '@deadair/sdk';

import { sdk } from './client';
import { useListWrite } from './mutation.kit';
import { queryKeys } from './query.keys';

/**
 * How long the kinds of break an operator writes stay fresh.
 *
 * The topics' reasoning: these move when an operator moves them, every write answers with the whole
 * list and is written straight into the cache, and the only invisible writer is somebody editing the
 * table by hand.
 */
const BREAK_KINDS_STALE_TIME = 30_000;

export const breakKindsOptions = queryOptions({
    queryKey: queryKeys.director.breakKinds(),
    queryFn: () => sdk.director.listBreakKinds(),
    staleTime: BREAK_KINDS_STALE_TIME,
});

/** Every kind of break the operator has written, switched on or not. */
export function useBreakKinds() {
    return useQuery(breakKindsOptions);
}

/** Every write, sharing one success path: the answer is the whole list, so nothing refetches. */
function useBreakKindWrite<TArgs>(mutationFn: (args: TArgs) => Promise<BreakKindList>) {
    // Switching a kind on or off changes which kinds the format clock can produce, which the schedule
    // page draws from the clock's own answer. Invalidated rather than written, since this answer says
    // nothing about bands.
    return useListWrite(queryKeys.director.breakKinds(), mutationFn, [queryKeys.director.clock()]);
}

export const useCreateBreakKind = () => useBreakKindWrite((body: BreakKindInput) => sdk.director.createBreakKind(body));

export const useUpdateBreakKind = () =>
    useBreakKindWrite(({ id, body }: { id: string; body: BreakKindInput }) => sdk.director.updateBreakKind(id, body));

export const useDeleteBreakKind = () => useBreakKindWrite((id: string) => sdk.director.deleteBreakKind(id));
