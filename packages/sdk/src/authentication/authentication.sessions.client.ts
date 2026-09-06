import type { AuthSession } from './types/authentication.types.js';
import type { SdkFetch } from '../sdk-options.js';
import { parseJson } from '../sdk-options.js';

/**
 * generated from [authentication.sessions.ck](../../../../apps/api/data/contracts/authentication/authentication.sessions.ck)
 */
export class AuthenticationSessionsClient {
    constructor(private fetch: SdkFetch) {}

    /**
     * @name Logout
     * @description revoke the caller's current session (self sign-out). Deliberately carries no policy gate: signing out must always clear the browser's httpOnly refresh cookie, including for a caller whose access token has already expired. A 401 here would leave a 30-day refresh cookie behind that silently signs the user back in on the next page load. SessionsService revokes the session only when the caller is actually authenticated; an anonymous caller still gets 204 and a cleared cookie.
     */
    async logout(): Promise<void> {
        await this.fetch(`/auth/logout`, { method: 'POST' });
    }

    /**
     * @name Read session
     * @description Who the caller is and which platform roles they hold
     */
    async readSession(): Promise<AuthSession> {
        const result = await this.fetch(`/auth/session`, { method: 'GET' });
        return await parseJson<AuthSession>(result);
    }
}
