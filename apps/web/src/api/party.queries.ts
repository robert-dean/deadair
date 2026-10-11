import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { sdk } from './client';
import { queryKeys } from './query.keys';

/**
 * A party: the pass guests join with by scanning its code, as the operator starts, shows and ends it.
 * Polled, slowly, for the count of guests who have joined, which changes from outside the console.
 * Starting and ending are `retry: false`: each is a decision, and starting twice behind the operator's
 * back would end the party they had just started.
 */
const REFRESH_MS = 30_000;

export const partyOptions = queryOptions({
    queryKey: queryKeys.party.state(),
    queryFn: () => sdk.requests.party.getParty(),
    refetchInterval: REFRESH_MS,
});

export function useParty() {
    return useQuery(partyOptions);
}

export function useStartParty() {
    const queryClient = useQueryClient();
    return useMutation({
        retry: false,
        mutationFn: (hours: number) => sdk.requests.party.startParty({ hours }),
        onSuccess: party => queryClient.setQueryData(queryKeys.party.state(), { party }),
    });
}

export function useEndParty() {
    const queryClient = useQueryClient();
    return useMutation({
        retry: false,
        mutationFn: () => sdk.requests.party.endParty(),
        onSuccess: () => queryClient.setQueryData(queryKeys.party.state(), {}),
    });
}

/**
 * The address a party's code holds: this console's own origin, then the guest page, then the pass
 * after `#`, which no server sees. The console's origin because that is the address this operator
 * reached the station at; {@link isLoopback} is how the card warns when a phone could not.
 */
export const partyLink = (token: string, origin: string = window.location.origin): string => `${origin}/party#${token}`;

/** Whether an origin names this machine only, which no guest's phone can reach. */
export function isLoopback(origin: string = window.location.origin): boolean {
    const host = new URL(origin).hostname;
    return host === 'localhost' || host === '[::1]' || host.startsWith('127.') || host.endsWith('.localhost');
}
