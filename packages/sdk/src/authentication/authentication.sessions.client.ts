import type { SdkFetch } from '../sdk-options.js';

/**
 * generated from [authentication.sessions.ck](file://./../../../../apps/api/data/contracts/authentication/authentication.sessions.ck)
 */
export class AuthenticationSessionsClient {
    constructor(private fetch: SdkFetch) {}

    /**
     * @name Logout
     * @description revoke the caller's current session (self sign-out)
     */
    async logout(): Promise<void> {
        await this.fetch(`/auth/logout`, { method: 'POST' });
    }
}
