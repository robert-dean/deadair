import { createSdkFetch, DeadairSdk, SdkError, type SdkFetch } from '@deadair/sdk';

import { authHeaders, clearSession } from '../auth/session.store';

/** The SPA is served from the same origin as the API, so a relative prefix is enough. */
const BASE_URL = '/api';

const baseFetch = createSdkFetch({
    baseUrl: BASE_URL,
    // Opts this client into the httpOnly refresh cookie instead of a body refresh token.
    headers: () => ({ ...authHeaders(), 'x-deadair-refresh-cookie': '1' }),
});

/**
 * Any 401 means the in-memory token is dead; drop it. Clearing a live session also advances the
 * session epoch, which re-arms the bootstrap cache, so the next gate evaluation re-tries the refresh
 * cookie rather than routing a still-redeemable user to /login. Done through the store rather than by
 * calling the bootstrap directly, which would make this module and `session.bootstrap` circular.
 */
const sessionAwareFetch: SdkFetch = async (url, init) => {
    try {
        return await baseFetch(url, init);
    } catch (error) {
        if (error instanceof SdkError && error.status === 401) {
            clearSession();
        }
        throw error;
    }
};

export const sdk = new DeadairSdk({ baseUrl: BASE_URL, fetch: sessionAwareFetch });
