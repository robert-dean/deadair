import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiKeyCreate } from '@deadair/sdk';

import { sdk } from './client';
import { queryKeys } from './query.keys';

/**
 * The signed-in account's API keys: a script's or an integration's way into the station, acting as
 * the account with less. Every mutation is `retry: false` for the reason `auth.factors.queries.ts`
 * gives, and one more: issuing and rotating each answer with a token that exists exactly once, so a
 * retry behind the operator's back would mint a second key and lose the first one's token.
 *
 * The token itself is never put in the query cache. It comes back on the mutation's result, the
 * card holds it in component state for as long as the operator is looking at it, and nothing else
 * in the console ever sees it.
 */

export const apiKeysOptions = queryOptions({
    queryKey: queryKeys.auth.apikeys(),
    queryFn: () => sdk.authentication.apikeys.listAPIKeys(),
});

/** Every key on the signed-in account, newest first, revoked and expired ones included. */
export function useApiKeys() {
    return useQuery(apiKeysOptions);
}

/**
 * Issues a key. Answers 403 with a step-up requirement when the account has a strong factor that
 * was not verified recently; the caller runs this through `useStepUpGate().run`.
 */
export function useCreateApiKey() {
    const queryClient = useQueryClient();
    return useMutation({
        retry: false,
        mutationFn: (request: ApiKeyCreate) => sdk.authentication.apikeys.createAPIKey({ ...request, name: request.name.trim() }),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.auth.apikeys() });
        },
    });
}

/** Gives a key a new token; the old one stops working at once. Behind the same step-up as issuing. */
export function useRotateApiKey() {
    const queryClient = useQueryClient();
    return useMutation({
        retry: false,
        mutationFn: ({ id }: { id: string }) => sdk.authentication.apikeys.rotateAPIKey(id),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.auth.apikeys() });
        },
    });
}

/** Revokes a key. It stays in the list, marked revoked, and is refused from the next request on. */
export function useRevokeApiKey() {
    const queryClient = useQueryClient();
    return useMutation({
        retry: false,
        mutationFn: ({ id }: { id: string }) => sdk.authentication.apikeys.revokeAPIKey(id),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.auth.apikeys() });
        },
    });
}
