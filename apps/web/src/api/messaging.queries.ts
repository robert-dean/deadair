import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { sdk } from './client';
import { queryKeys } from './query.keys';

/**
 * Chat accounts linked to the signed-in account. A linked account can skip a record or take the
 * station off the air from a chat, with this account's permissions. Every mutation is `retry: false`
 * for `auth.apikeys.queries.ts`'s reason: a code exists once, and a retry behind the operator's back
 * would mint a second and silently replace the one on screen.
 */

export const messagingLinksOptions = queryOptions({
    queryKey: queryKeys.messaging.links(),
    queryFn: () => sdk.messaging.listMessagingLinks(),
});

/** The chat accounts linked to the signed-in account, newest first. */
export function useMessagingLinks() {
    return useQuery(messagingLinksOptions);
}

/** A new one-time code. It replaces any earlier one and lasts ten minutes. Never cached. */
export function useCreateMessagingLinkCode() {
    return useMutation({
        retry: false,
        mutationFn: () => sdk.messaging.createMessagingLinkCode(),
    });
}

/** Unlinks a chat account. Its operator commands are refused from the next one on. */
export function useRemoveMessagingLink() {
    const queryClient = useQueryClient();
    return useMutation({
        retry: false,
        mutationFn: ({ pluginId, platformUserId }: { pluginId: string; platformUserId: string }) =>
            sdk.messaging.removeMessagingLink(pluginId, platformUserId),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.messaging.links() });
        },
    });
}
