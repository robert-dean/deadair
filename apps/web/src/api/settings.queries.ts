import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { StationSettings } from '@deadair/sdk';

import { sdk } from './client';
import { queryKeys } from './query.keys';

/**
 * How long the station's settings stay fresh.
 *
 * They move when an operator moves them, and that call hands back the whole answer, which is
 * written straight into the cache below. The only invisible writer is somebody editing the table
 * by hand — which the API now picks up live, but which is rare enough that polling for it would
 * spend far more requests than it earns. Same reasoning as `PLUGIN_STALE_TIME`.
 */
const SETTINGS_STALE_TIME = 30_000;

export const settingsOptions = queryOptions({
    queryKey: queryKeys.settings.all(),
    queryFn: () => sdk.settings.getSettings(),
    staleTime: SETTINGS_STALE_TIME,
});

/** Every station setting, its descriptor and its current value. */
export function useSettings() {
    return useQuery(settingsOptions);
}

/**
 * Apply a submitted settings form.
 *
 * The response is the settings as they now stand, so it is written into the cache rather than
 * triggering a refetch: the API has already resolved what the write means, including the defaults
 * that came back for anything the operator cleared.
 */
export function useUpdateSettings() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (values: Record<string, unknown>) => sdk.settings.updateSettings({ values }),
        onSuccess: (settings: StationSettings) => {
            queryClient.setQueryData(queryKeys.settings.all(), settings);
            // Several of these settings decide which plugin does a job and in what order, and the
            // station is what works the resulting order out. Invalidated unconditionally rather
            // than only for the provider keys: the check would be a list of keys kept in step by
            // hand, and this is one request after a save the operator is watching anyway.
            void queryClient.invalidateQueries({ queryKey: queryKeys.plugins.providers() });
            // The same argument for the release check: switching it off hides the header's notice
            // at once only if the console asks again, rather than at its next half-hourly poll.
            void queryClient.invalidateQueries({ queryKey: queryKeys.station.releases() });
        },
    });
}

/**
 * Whether each identity provider in the sign-in settings answers as one.
 *
 * Asked once per stored provider list and not again on focus or on a timer, because every ask
 * reaches out to each issuer. `providers` is the stored `signin.providers` value, which is what
 * makes a save that changed a row ask again.
 */
export function useSigninCheck(providers: string | undefined) {
    return useQuery({
        queryKey: queryKeys.settings.signinCheck(providers ?? ''),
        queryFn: () => sdk.settings.checkSignInProviders(),
        enabled: providers !== undefined,
        staleTime: Infinity,
        refetchOnWindowFocus: false,
        retry: false,
    });
}
