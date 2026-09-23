import { Injectable } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { OAuthAuthorizationServer, type AuthorizationContextResult } from '@maroonedsoftware/authentication';
import { httpError } from '@maroonedsoftware/errors';
import { AuthorizationContext } from '#modules/permissions/authorization.context.js';
import { SessionActivityService } from '#modules/authentication/session.activity.service.js';
import { StrongFactorGate } from '#modules/authentication/strong.factor.gate.js';
import { oauthIsEnabled } from './oauth.settings.js';
import type {
    OAuthAuthorizationContextResult,
    OAuthAuthorizationDecision,
    OAuthAuthorizationOutcome,
    OAuthAuthorizationQuery,
} from './types/oauth.types.js';

/**
 * The consent page's API: what an app is asking for, and the signed-in person's answer.
 *
 * The browser arrives at the console's `/oauth/authorize` with the app's request in its query
 * string, signs in if it has to, and the page sends that query string here. `describe` validates it
 * once and stashes it for this person; `approve` and `deny` name the stash, so what is approved is
 * exactly what was validated, and nothing a tampered page sends can widen it.
 *
 * Every method starts with `requireAuthentication`, which refuses a request made with an API key:
 * a key must never approve an app to act as its owner. Approving sits behind the same step-up as
 * issuing an API key, because it hands out a credential that acts as the account; denying does not,
 * because turning an app away is never the change a stolen session wants.
 */
@Injectable()
export class OAuthConsentService {
    constructor(
        private readonly authz: AuthorizationContext,
        private readonly config: AppConfig,
        private readonly server: OAuthAuthorizationServer,
        private readonly strongFactorGate: StrongFactorGate,
        private readonly sessionActivity: SessionActivityService,
    ) {}

    async describe(request: OAuthAuthorizationQuery): Promise<OAuthAuthorizationContextResult> {
        const { actorId } = this.authz.requireAuthentication();
        this.assertEnabled();
        return toContract(await this.server.describeAuthorizationRequest(parseQuery(request.query), actorId));
    }

    async approve(decision: OAuthAuthorizationDecision): Promise<OAuthAuthorizationOutcome> {
        const { actorId } = this.authz.requireAuthentication();
        this.assertEnabled();
        await this.strongFactorGate.assertRecentIfAnyEnrolled(actorId);

        // The grant is a session of this person's own, so it carries what a sign-in would: the
        // claim the authorization context reads to call it a user, where they signed in from, and
        // the factors this session holds.
        const actor = this.authz.actor;
        const factors = actor.kind === 'user' ? [...actor.factors] : [];
        return await this.server.approve(decision.requestId, {
            subject: actorId,
            claims: { actorType: 'user', ...this.sessionActivity.buildLoginContextClaims() },
            factors,
        });
    }

    async deny(decision: OAuthAuthorizationDecision): Promise<OAuthAuthorizationOutcome> {
        const { actorId } = this.authz.requireAuthentication();
        this.assertEnabled();
        return await this.server.deny(decision.requestId, actorId);
    }

    private assertEnabled(): void {
        if (!oauthIsEnabled(this.config)) throw httpError(404).withDetails({ oauth: 'apps may not connect to this station' });
    }
}

/**
 * `?client_id=x&scope=a` as the library wants it. A parameter given twice stays a list, because a
 * repeated `client_id` or `redirect_uri` is a malformed request the library refuses rather than one
 * whose first value it should pick.
 */
export function parseQuery(query: string): Record<string, string | string[]> {
    const params: Record<string, string | string[]> = {};
    for (const [key, value] of new URLSearchParams(query.startsWith('?') ? query.slice(1) : query)) {
        const existing = params[key];
        params[key] = existing === undefined ? value : Array.isArray(existing) ? [...existing, value] : [existing, value];
    }
    return params;
}

function toContract(result: AuthorizationContextResult): OAuthAuthorizationContextResult {
    switch (result.kind) {
        case 'context':
            return {
                kind: 'context',
                requestId: result.requestId,
                clientId: result.clientId,
                clientKind: result.clientKind,
                ...(result.clientName === undefined ? {} : { clientName: result.clientName }),
                ...(result.clientUri === undefined ? {} : { clientUri: result.clientUri }),
                ...(result.logoUri === undefined ? {} : { logoUri: result.logoUri }),
                redirectHost: result.redirectHost,
                loopbackOnly: result.loopbackOnly,
                scope: result.scope,
                resource: result.resource,
            };
        case 'redirect':
            return { kind: 'redirect', redirectUrl: result.redirectUrl };
        case 'refuse':
            return { kind: 'refuse', error: result.error, description: result.description };
    }
}
