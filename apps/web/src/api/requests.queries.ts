import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ListenerRequestCreate } from '@deadair/sdk';

import { sdk } from './client';
import { queryKeys } from './query.keys';

/**
 * Listener requests, as the operator sees them: everything recent, whatever became of it. Polled,
 * because a request arrives from outside the console (an app, a chat) and an operator approving them
 * is waiting on the next one. Each decision is `retry: false`: a grant retried behind the operator's
 * back would be answered 409 the second time and read as a failure.
 */

/** How often the list is asked again while the tab is open. Slow enough to cost nothing, quick enough for somebody approving. */
const REFRESH_MS = 15_000;

export const requestsOptions = queryOptions({
    queryKey: queryKeys.requests.list(),
    queryFn: () => sdk.requests.listRequests(),
    refetchInterval: REFRESH_MS,
});

export function useRequests() {
    return useQuery(requestsOptions);
}

export function useGrantRequest() {
    const queryClient = useQueryClient();
    return useMutation({
        retry: false,
        mutationFn: (id: string) => sdk.requests.grantRequest(id),
        onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.requests.list() }),
    });
}

export function useDeclineRequest() {
    const queryClient = useQueryClient();
    return useMutation({
        retry: false,
        mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
            sdk.requests.declineRequest(id, reason === undefined || reason.trim() === '' ? {} : { reason: reason.trim() }),
        onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.requests.list() }),
    });
}

/**
 * Records the station could be asked for, matching what the operator typed. Off until there is a
 * term worth sending, so the box does not ask the providers for every letter.
 */
export function useRequestSearch(term: string | undefined, limit: number) {
    return useQuery({
        queryKey: queryKeys.requests.search(term ?? ''),
        queryFn: () => sdk.requests.searchRequestableRecords({ q: term!, limit }),
        enabled: term !== undefined,
        retry: false,
    });
}

/**
 * Ask for a record as a listener would. A refusal is a 201 like any other answer, so the caller reads
 * the status it comes back with. The list is asked again because the request is now one of them.
 */
export function useCreateRequest() {
    const queryClient = useQueryClient();
    return useMutation({
        retry: false,
        mutationFn: (body: ListenerRequestCreate) => sdk.requests.createRequest(body),
        onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.requests.list() }),
    });
}
