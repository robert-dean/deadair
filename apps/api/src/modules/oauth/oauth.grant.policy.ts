import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { getOAuthSessionClaim, type AuthenticationSession } from '@maroonedsoftware/authentication';
import { Policy, type PolicyResult } from '@maroonedsoftware/policies';
import { OAuthOptions } from './oauth.options.js';
import { oauthIsEnabled } from './oauth.settings.js';

/** What `requirePolicy` asserts with, whatever the policy. */
export interface OAuthGrantPolicyContext {
    session: AuthenticationSession;
}

/**
 * The gate on the MCP endpoint: a session an app was granted, through OAuth, for this station's MCP
 * resource, while OAuth is on.
 *
 * The audience check in the JWT issuer already refuses any token not bound to the resource at the
 * MCP path, so a console session never reaches this as a session at all. This is the second lock,
 * and the one that reads the grant itself: a session without `claims.oauth`, or with one naming a
 * different resource, is refused however it got here, and so is everything the moment an operator
 * switches OAuth off, without waiting for the tokens already issued to run out.
 */
@Injectable()
export class OAuthGrantPolicy extends Policy<OAuthGrantPolicyContext> {
    constructor(private readonly config: AppConfig) {
        super();
    }

    async evaluate({ session }: OAuthGrantPolicyContext): Promise<PolicyResult> {
        if (!oauthIsEnabled(this.config)) return this.deny('oauth_disabled');
        const resource = OAuthOptions.fromConfig(this.config)?.resource;
        const claim = getOAuthSessionClaim(session);
        if (resource === undefined || claim?.resource !== resource) return this.deny('oauth_grant_required');
        return this.allow();
    }
}
