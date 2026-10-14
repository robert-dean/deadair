import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EventDestinationCreate, EventDestinationUpdate } from '@deadair/sdk';

import { sdk } from './client';
import { queryKeys } from './query.keys';

/**
 * Event destinations: an operator's own servers the station sends a signed POST to as things happen
 * on air. Every mutation is `retry: false`. Creating one and making a new secret each answer with a
 * signing secret that exists exactly once, so a retry behind the operator's back would mint a second
 * destination or a second secret and lose the first one; and a test is a request to a server
 * somebody else runs, which the operator asked for once.
 *
 * The secret is never put in the query cache, on `auth.apikeys.queries.ts`'s rule: it comes back on
 * the mutation's result and the card holds it only while it is on screen.
 */

export const eventDestinationsOptions = queryOptions({
    queryKey: queryKeys.events.destinations(),
    queryFn: () => sdk.events.listEventDestinations(),
});

/** Every destination, oldest first, each with how its deliveries have been going. */
export function useEventDestinations() {
    return useQuery(eventDestinationsOptions);
}

/** Every kind of event the station sends, with an example of each. Fixed for a given station version. */
export function useEventTypes() {
    return useQuery({ queryKey: queryKeys.events.types(), queryFn: () => sdk.events.listEventTypes(), staleTime: Infinity });
}

/** A destination's latest delivery attempts, newest first. Only asked for while somebody is looking. */
export function useEventDeliveries(id: string | undefined) {
    return useQuery({
        queryKey: queryKeys.events.deliveries(id ?? ''),
        queryFn: () => sdk.events.listEventDeliveries(id!),
        enabled: id !== undefined,
    });
}

export function useCreateEventDestination() {
    const queryClient = useQueryClient();
    return useMutation({
        retry: false,
        mutationFn: (request: EventDestinationCreate) => sdk.events.createEventDestination(request),
        onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.events.destinations() }),
    });
}

/** Changes a destination. Turning one back on also clears why the station turned it off. */
export function useUpdateEventDestination() {
    const queryClient = useQueryClient();
    return useMutation({
        retry: false,
        mutationFn: ({ id, changes }: { id: string; changes: EventDestinationUpdate }) => sdk.events.updateEventDestination(id, changes),
        onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.events.destinations() }),
    });
}

export function useDeleteEventDestination() {
    const queryClient = useQueryClient();
    return useMutation({
        retry: false,
        mutationFn: ({ id }: { id: string }) => sdk.events.deleteEventDestination(id),
        onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.events.destinations() }),
    });
}

/** A new signing secret; the old one stops working at once. */
export function useRotateEventDestinationSecret() {
    return useMutation({ retry: false, mutationFn: ({ id }: { id: string }) => sdk.events.rotateEventDestinationSecret(id) });
}

/** Sends a destination a test event now. The answer is what it said; the attempt lands in its log. */
export function useTestEventDestination() {
    const queryClient = useQueryClient();
    return useMutation({
        retry: false,
        mutationFn: ({ id }: { id: string }) => sdk.events.testEventDestination(id),
        onSuccess: (_, { id }) => void queryClient.invalidateQueries({ queryKey: queryKeys.events.deliveries(id) }),
    });
}
