import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AuthenticationTokenResponseOutput } from '@deadair/sdk';

import { sdk } from './client';
import { clearSession, setSession } from '../auth/session.store';

export interface LoginCredentials {
    email: string;
    password: string;
}

/**
 * Signs in with a password.
 *
 * `retry: false` on purpose, against the app-wide mutation default. A 401 here is a wrong password
 * and would not be retried anyway, but a 429 would be — and silently replaying a sign-in behind the
 * user's back is worse than telling them how long the limiter wants them to wait. The page reads
 * `retryAfterMs` off the error and says so.
 *
 * Resolves the raw token response: `result === 'mfa_required'` is a **200**, a sign-in that stopped
 * at a challenge rather than a failure, so the caller branches on it rather than catching it.
 */
export function useLoginMutation() {
    return useMutation({
        retry: false,
        mutationFn: ({ email, password }: LoginCredentials) =>
            sdk.authentication.requestToken({ grant_type: 'password', username: email, password }),
        onSuccess: (response: AuthenticationTokenResponseOutput) => {
            if (response.result === 'token') {
                setSession(response.access_token, response.expires_in);
            }
        },
    });
}

/**
 * Revokes the server-side session and tears down everything local.
 *
 * The local teardown runs whether or not the revoke succeeded — a failed revoke must not strand the
 * user in a signed-in shell — so it lives in `onSettled`, and the caller reports the shortfall from
 * the error. `queryClient.clear()` is the load-bearing part: it drops the cached refresh-cookie
 * verdict along with everything else, so the next person to sign in on this tab inherits none of
 * the previous user's state.
 */
export function useLogoutMutation() {
    const queryClient = useQueryClient();
    return useMutation({
        retry: false,
        mutationFn: () => sdk.authentication.sessions.logout(),
        onSettled: () => {
            clearSession();
            queryClient.clear();
        },
    });
}
