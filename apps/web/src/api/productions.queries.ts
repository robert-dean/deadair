import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProductionRequest } from '@deadair/sdk';

import { sdk } from './client';
import { queryKeys } from './query.keys';

/**
 * How often the list is re-read while something is being made.
 *
 * Short, and for a reason the other pages do not have: a production moves through its passes on its
 * own over minutes, with no event the console could hear. Every other list here changes only when an
 * operator changes it, so 30 seconds is plenty; this one is the station working while somebody
 * watches.
 *
 * Not a second, though. Nothing about a pass is worth seeing sooner than this, and the alternative
 * is a page that polls harder than the playout transport for information that changes every few
 * minutes.
 */
const PRODUCTIONS_POLL_MS = 10_000;

export const productionsOptions = queryOptions({
    queryKey: queryKeys.productions.list(),
    queryFn: () => sdk.productions.listProductions(),
    refetchInterval: PRODUCTIONS_POLL_MS,
});

/** Everything the station has made or is making, newest first. */
export function useProductions() {
    return useQuery(productionsOptions);
}

/**
 * Both writes, sharing one success path.
 *
 * Each answers with the ONE production it touched rather than the whole list, unlike the personas
 * page — requesting one changes nothing about the others, and cancelling one changes nothing else
 * either. So the answer cannot be written straight into the cache as the list; the list is
 * invalidated and refetched instead.
 */
function useListRefresh<TArgs, TResult>(mutationFn: (args: TArgs) => Promise<TResult>) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn,
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.productions.list() });
        },
    });
}

/**
 * Ask the station to make one.
 *
 * It is QUEUED rather than started, which the page says out loud: the answer comes back within a
 * request while the production itself takes minutes, and an operator who expected the second would
 * read the first as it having failed.
 */
export const useRequestProduction = () => useListRefresh((body: ProductionRequest) => sdk.productions.requestProduction(body));

/** Stop one, for good. */
export const useCancelProduction = () => useListRefresh((id: string) => sdk.productions.cancelProduction(id));
