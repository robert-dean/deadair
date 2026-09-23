import { queryOptions, useQuery } from '@tanstack/react-query';

import { sdk } from './client';
import { queryKeys } from './query.keys';

/**
 * The identity providers the sign-in page offers beside a password, as buttons.
 *
 * Public on the API, since it is asked before anybody is signed in. A station that cannot answer
 * draws no buttons rather than an error: the password and the emailed link still work, and a
 * failure here is not something the person at the sign-in page can do anything about.
 */
export const signinProvidersOptions = queryOptions({
    queryKey: queryKeys.auth.providers(),
    queryFn: () => sdk.authentication.listSignInProviders(),
    staleTime: 60_000,
    retry: false,
});

export function useSigninProviders() {
    return useQuery(signinProvidersOptions);
}
