import { queryOptions, useMutation, useQuery } from '@tanstack/react-query';

import { sdk } from './client';
import { queryKeys } from './query.keys';

/**
 * An app's authorization request, as the station reads it for the consent page.
 *
 * A query rather than a mutation although the API stashes the request for this person as it answers,
 * because the page needs it on arrival and exactly once: `staleTime: Infinity` and no retry mean a
 * re-render or a second mount reads the cache rather than stashing it again, and a request the
 * station refused is not asked again behind the person's back.
 */
export const authorizationRequestOptions = (query: string) =>
    queryOptions({
        queryKey: queryKeys.oauth.authorization(query),
        queryFn: () => sdk.oauth.describeAuthorizationRequest({ query }),
        staleTime: Infinity,
        gcTime: Infinity,
        retry: false,
    });

export function useAuthorizationRequest(query: string) {
    return useQuery(authorizationRequestOptions(query));
}

/**
 * Letting the app act as the signed-in person. Answers 403 with a step-up requirement when the
 * account's strong factor is older than the gate allows; the page runs it through `useStepUpGate`.
 * `retry: false`, since a second approval behind the person's back would mint a second code.
 */
export function useApproveAuthorization() {
    return useMutation({
        retry: false,
        mutationFn: (requestId: string) => sdk.oauth.approveAuthorizationRequest({ requestId }),
    });
}

/** Turning the app away. It is told the person said no. */
export function useDenyAuthorization() {
    return useMutation({
        retry: false,
        mutationFn: (requestId: string) => sdk.oauth.denyAuthorizationRequest({ requestId }),
    });
}
