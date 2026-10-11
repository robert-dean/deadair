import { createSdkFetch, DeadairSdk } from '@deadair/sdk';

/**
 * The guest page's own client: the same SDK as the console, and none of the console's sign-in. A
 * guest has no refresh cookie and no way to get a new session but the party's code, so a 401 here is
 * the end of the party rather than something to recover from.
 */
let bearer: string | undefined;

/** The guest session every request after joining carries, or none before it. */
export function setGuestToken(token: string | undefined): void {
    bearer = token;
}

export const partySdk = new DeadairSdk({
    baseUrl: '/api',
    fetch: createSdkFetch({
        baseUrl: '/api',
        headers: (): Record<string, string> => (bearer === undefined ? {} : { authorization: `Bearer ${bearer}` }),
    }),
});
