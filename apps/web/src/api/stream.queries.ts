import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FetcherAuthorization, FetcherAuthorizationFinished, FetcherAuthorizationStart } from '@deadair/sdk';

import { sdk } from './client';
import { queryKeys } from './query.keys';

/**
 * How long the fetcher's authorization stays fresh.
 *
 * Longer than a plugin record, because this moves less than anything else on the page: a stored
 * authorization is written once and then used for months, and the two things that DO move it are
 * both operator actions on this very card, which write their answer back into the cache.
 *
 * What it deliberately does not do is poll. The state it reports is a credential on disk, not a
 * connection, so a station whose fetcher is fine would be asking a question with one answer forever.
 */
const AUTHORIZATION_STALE_TIME = 60_000;

export const fetcherAuthorizationOptions = queryOptions({
    queryKey: queryKeys.stream.authorization(),
    queryFn: () => sdk.stream.readFetcherAuthorization(),
    staleTime: AUTHORIZATION_STALE_TIME,
});

/**
 * What the track fetcher holds by way of a Spotify login.
 *
 * `enabled` because only a plugin that actually feeds the fetcher has any business asking: on every
 * other plugin's page this is a question about somebody else.
 */
export function useFetcherAuthorization(enabled: boolean) {
    return useQuery({ ...fetcherAuthorizationOptions, enabled });
}

/**
 * Start the one-time authorization.
 *
 * The answer is not written into the cache, and that is deliberate: what comes back is a URL to
 * open, which belongs to the attempt the operator is in the middle of, while the cached reading is
 * about what the station HOLDS. Folding the first into the second would have the card announce an
 * authorization as pending before the operator has done anything with it.
 */
export function useStartFetcherAuthorization() {
    return useMutation<FetcherAuthorizationStart, unknown, void>({
        mutationFn: () => sdk.stream.startFetcherAuthorization(),
    });
}

/** Finish it from the address the operator's browser ended up at. */
export function useFinishFetcherAuthorization() {
    const client = useQueryClient();

    return useMutation<FetcherAuthorizationFinished, unknown, string>({
        mutationFn: redirectUrl => sdk.stream.finishFetcherAuthorization({ redirectUrl }),
        onSuccess: finished => {
            // Written through rather than invalidated. The station is now authorized as this account
            // and the app has just been told so by the process that did it, so re-asking would spend
            // a request to be told the same thing — and would leave the card showing the old state
            // for as long as the round trip takes, right after the one action that changed it.
            client.setQueryData<FetcherAuthorization>(queryKeys.stream.authorization(), previous =>
                previous === undefined
                    ? previous
                    : {
                          ...previous,
                          reachable: true,
                          configured: true,
                          authorized: true,
                          session: true,
                          loginError: undefined,
                          pendingUrl: undefined,
                      },
            );
            return finished;
        },
    });
}

/**
 * How often the list is read again while it is open.
 *
 * Five seconds, a third of the window an HLS player is counted for, so somebody who closes their
 * player drops off the page about as soon as the station stops counting them. Each read asks Icecast
 * for every mount, which is a few small requests on the station's own network, and it stops when the
 * page closes because nothing else holds this query.
 */
const LISTENERS_REFETCH_MS = 5_000;

export const streamListenersOptions = queryOptions({
    queryKey: queryKeys.stream.listeners(),
    queryFn: () => sdk.stream.listStreamListeners(),
    refetchInterval: LISTENERS_REFETCH_MS,
});

/** Who is connected to the stream right now, one row per connection. Operators only: others are answered 403. */
export function useStreamListeners() {
    return useQuery(streamListenersOptions);
}
