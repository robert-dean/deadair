import { createSdkFetch, DeadairSdk, type SdkFetch } from '@deadair/sdk';

import { authHeaders, clearSession } from '../auth/session.store';
import { refreshSession } from '../auth/session.refresher';
import { isInvalidToken } from './sdk.error';

/** The SPA is served from the same origin as the API, so a relative prefix is enough. */
export const BASE_URL = '/api';

// No `requestIdFactory`: the SDK's default has worked over plain HTTP since ContractKit
// plugin-typescript 0.38.12, and `tests/api/client.insecure.test.ts` holds it to that (issue #78).
const baseFetch = createSdkFetch({
    baseUrl: BASE_URL,
    // Opts this client into the httpOnly refresh cookie instead of a body refresh token.
    headers: () => ({ ...authHeaders(), 'x-deadair-refresh-cookie': '1' }),
});

/**
 * Requests that must never trigger a refresh-on-401, because doing so would eat its own tail.
 *
 * `/auth/token` **is** the redeem: a 401 from it is the answer the redeem was asking for, and
 * asking again would recurse. `/auth/logout` is deliberately ungated server-side and clears the
 * cookie regardless, so a 401 from it is not something a new token would fix.
 */
const NO_REFRESH_PATHS = ['/auth/token', '/auth/logout'];

function isRefreshExempt(url: string): boolean {
    return NO_REFRESH_PATHS.some(path => url === path || url.startsWith(`${path}?`));
}

/**
 * Turns a 401 into a silent recovery where one is available.
 *
 * An expired access token is the ordinary case, not an error: the refresh cookie outlives it by
 * design. So a 401 first tries one redeem and, if that lands, replays the original request — the
 * caller never sees the failure. Only when the cookie cannot buy a session does the token get
 * dropped and the error propagate, which is what routes the user to /login on the next gate
 * evaluation. Clearing goes through the store rather than the bootstrap, so this module stays free
 * of anything that imports it back.
 *
 * Replaying is sound because every SDK method serialises its body to a string (`JSON.stringify`
 * or `URLSearchParams.toString()`) and never a stream, so `init` can be re-issued as-is. A method
 * that starts sending a `ReadableStream` body would break that assumption.
 */
const sessionAwareFetch: SdkFetch = async (url, init) => {
    try {
        return await baseFetch(url, init);
    } catch (error) {
        if (!isInvalidToken(error)) {
            throw error;
        }
        if (isRefreshExempt(url) || !(await refreshSession())) {
            clearSession();
            throw error;
        }
        try {
            // One replay only: this goes straight to the base fetch, so a second 401 cannot
            // re-enter the recovery path.
            return await baseFetch(url, init);
        } catch (replayError) {
            if (isInvalidToken(replayError)) {
                clearSession();
            }
            throw replayError;
        }
    }
};

export const sdk = new DeadairSdk({ baseUrl: BASE_URL, fetch: sessionAwareFetch });
