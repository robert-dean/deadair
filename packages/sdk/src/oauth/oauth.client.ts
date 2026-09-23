import type { SdkFetch } from '../sdk-options.js';
import { bigIntReplacer, parseJson } from '../sdk-options.js';
import type {
    OAuthAuthorizationContextResult,
    OAuthAuthorizationDecision,
    OAuthAuthorizationOutcome,
    OAuthAuthorizationQuery,
    OAuthClientCreate,
    OAuthClientIssued,
    OAuthClientList,
    OAuthGrantList,
} from './types/oauth.types.js';
import { reviveOAuthClientIssued, reviveOAuthClientList, reviveOAuthGrantList } from './types/oauth.types.js';

export class OauthClient {
    constructor(private fetch: SdkFetch) {}

    /**
     * @name Describe authorization request
     * @description Validate an app's authorization request for the consent page, and stash it for the signed-in person. A POST because it stashes: what is approved is exactly what was validated here
     */
    async describeAuthorizationRequest(body: OAuthAuthorizationQuery): Promise<OAuthAuthorizationContextResult> {
        const result = await this.fetch(`/auth/oauth/authorize/context`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<OAuthAuthorizationContextResult>(result);
    }

    /**
     * @name Approve authorization request
     * @description Let the app act as the signed-in person. Once the account has a strong second factor, this needs one verified in the last five minutes
     */
    async approveAuthorizationRequest(body: OAuthAuthorizationDecision): Promise<OAuthAuthorizationOutcome> {
        const result = await this.fetch(`/auth/oauth/authorize/approve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<OAuthAuthorizationOutcome>(result);
    }

    /**
     * @name Deny authorization request
     * @description Turn the app away. It is told the person said no
     */
    async denyAuthorizationRequest(body: OAuthAuthorizationDecision): Promise<OAuthAuthorizationOutcome> {
        const result = await this.fetch(`/auth/oauth/authorize/deny`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<OAuthAuthorizationOutcome>(result);
    }

    /**
     * @name List OAuth clients
     * @description Every app registered with the station, by an operator or by itself
     */
    async listOAuthClients(): Promise<OAuthClientList> {
        const result = await this.fetch(`/auth/oauth/clients`, { method: 'GET' });
        return reviveOAuthClientList(await parseJson<OAuthClientList>(result));
    }

    /**
     * @name Create OAuth client
     * @description Register an app by hand. The secret, for an app that keeps one, is in this response and nowhere else
     */
    async createOAuthClient(body: OAuthClientCreate): Promise<OAuthClientIssued> {
        const result = await this.fetch(`/auth/oauth/clients`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return reviveOAuthClientIssued(await parseJson<OAuthClientIssued>(result));
    }

    /**
     * @name Revoke OAuth client
     * @description Withdraw an app. Every person's approval of it ends, and so does every token it holds
     */
    async revokeOAuthClient(clientId: string): Promise<void> {
        await this.fetch(`/auth/oauth/clients/${encodeURIComponent(clientId)}`, { method: 'DELETE' });
    }

    /**
     * @name List OAuth grants
     * @description The apps the signed-in person has let act as them
     */
    async listOAuthGrants(): Promise<OAuthGrantList> {
        const result = await this.fetch(`/auth/oauth/grants`, { method: 'GET' });
        return reviveOAuthGrantList(await parseJson<OAuthGrantList>(result));
    }

    /**
     * @name Revoke OAuth grant
     * @description Disconnect an app. Every token it holds for this person stops working at once
     */
    async revokeOAuthGrant(id: string): Promise<void> {
        await this.fetch(`/auth/oauth/grants/${encodeURIComponent(id)}`, { method: 'DELETE' });
    }
}
