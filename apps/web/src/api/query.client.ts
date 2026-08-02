import { QueryClient } from '@tanstack/react-query';

import { setSessionRefresher } from '../auth/session.refresher';
import { restoreSession } from '../auth/session.bootstrap';
import { retryOnTransient, retryOnTransientMutation, transientRetryDelay } from './retry.policy';

/**
 * The app's single QueryClient.
 *
 * Built by a factory rather than exported as a module singleton so tests get a clean cache per
 * case, and so the refresh wiring below is re-established with the client it belongs to.
 */
export function createQueryClient(): QueryClient {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: {
                staleTime: 30_000,
                gcTime: 5 * 60_000,
                retry: retryOnTransient,
                retryDelay: transientRetryDelay,
                // Off on purpose. The API is rate limited, and nearly everything the console reads
                // is configuration rather than telemetry, so a refetch every time the operator
                // alt-tabs back spends request budget to redisplay the same bytes. Live data opts
                // back in per query.
                refetchOnWindowFocus: false,
                refetchOnReconnect: true,
            },
            mutations: {
                retry: retryOnTransientMutation,
                retryDelay: transientRetryDelay,
            },
        },
    });

    // Closes the loop the API client cannot close itself: a 401 there reaches the refresh cookie
    // through this, and lands back in the same cache that holds the verdict. See `session.refresher`.
    setSessionRefresher(() => restoreSession(queryClient));

    return queryClient;
}
