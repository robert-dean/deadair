import { createSdkFetch, DeadairSdk } from '@deadair/sdk';

/**
 * The invite page's own client: the same SDK as the console, with no session at all. Somebody accepting
 * an invitation has no account yet, so every route this page calls is public and carries the
 * invitation's token in its body instead.
 */
export const inviteSdk = new DeadairSdk({
    baseUrl: '/api',
    fetch: createSdkFetch({ baseUrl: '/api' }),
});
