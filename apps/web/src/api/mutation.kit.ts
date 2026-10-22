import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';

/**
 * The two ways a write here keeps the cache honest, written once.
 *
 * Fourteen query files each declared a private `useXWrite` or `useXArrival` that was one of these two
 * with its own key in it. The INLINE writes that invalidate on success are deliberately left alone:
 * some return the refetch so the mutation waits for it and some `void` it so it does not, and which
 * one a write wants is a decision about that write rather than boilerplate.
 */

/**
 * A write whose answer IS what the cache holds (the whole list, the whole reading), written straight
 * into it, so nothing refetches.
 *
 * `key` may be worked out from the answer, for a list kept per parent (a persona's notes are keyed by
 * the persona the answer names). `invalidates` is for what the write changed that its answer does
 * not describe, such as the format clock a deleted subject leaves stale; those are refetched without
 * the write waiting for them.
 */
export function useListWrite<TArgs, TAnswer>(
    key: QueryKey | ((answer: TAnswer) => QueryKey),
    mutationFn: (args: TArgs) => Promise<TAnswer>,
    invalidates: readonly QueryKey[] = [],
) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn,
        onSuccess: (answer: TAnswer) => {
            queryClient.setQueryData(typeof key === 'function' ? key(answer) : key, answer);
            for (const stale of invalidates) void queryClient.invalidateQueries({ queryKey: stale });
        },
    });
}

/**
 * A write whose answer cannot be trusted to be the whole story, so the list is refetched however it
 * ends, and the write waits for that.
 *
 * For an upload, where one outcome is neither a success nor a plain failure (a sound kept in the
 * library but refused a set, a picture stored but not taken): writing the answer would be wrong on a
 * failure, and doing nothing would leave an operator told one thing while looking at another.
 */
export function useSettledWrite<TArgs, TResult>(key: QueryKey, mutationFn: (args: TArgs) => Promise<TResult>) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn,
        onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
    });
}
