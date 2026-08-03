import { AuthRecentFactorPolicy, AuthRecentFactorPolicyContext } from './policies/auth.recent.factor.policy.js';
import { AuthMfaSatisfiedPolicy } from './policies/auth.mfa.satisfied.policy.js';
import { Constructor } from 'injectkit';
import { Policy, PolicyResult } from '@maroonedsoftware/policies';
import {
    AuthenticationPolicyNames,
    AuthMfaRequiredPolicyContext,
    AuthMfaSatisfiedPolicyContext,
    DefaultMfaRequiredPolicy,
    EmailAllowedPolicy,
    EmailAllowedPolicyContext,
    OAuth2ProfileAllowedPolicy,
    OAuth2ProfileAllowedPolicyContext,
    OidcProfileAllowedPolicy,
    OidcProfileAllowedPolicyContext,
    PasswordAllowedPolicy,
    PasswordAllowedPolicyContext,
    PhoneAllowedPolicy,
    PhoneAllowedPolicyContext,
    RecoveryAllowedPolicy,
    RecoveryAllowedPolicyContext,
    DefaultAssuranceLevelPolicy,
    AuthAssuranceLevelPolicyContext,
    SupportVerificationAllowedPolicy,
    SupportVerificationAllowedPolicyContext,
} from '@maroonedsoftware/authentication';
import { AlwaysAllowPolicy, AlwaysDenyPolicy } from '@maroonedsoftware/policies';
import { AuthenticationSession } from '@maroonedsoftware/authentication';
import { Injectable } from 'injectkit';
import { PLATFORM_NAMESPACE, rolesGrant } from '#modules/permissions/platform.roles.js';
import { ServerPolicyEnvelope } from './policy.envelope.js';

/**
 * Policy names this application adds on top of the authentication library's.
 * A generated router opts a route in by naming one in its contract's
 * `security: { policy: ... }` block, which becomes `requirePolicy({ policy })`.
 */
export type DeadairPolicyNames = 'platform.manage';

/** `requirePolicy` always asserts with `{ session }`, whatever the policy needs. */
export interface RequirePolicyContext {
    session: AuthenticationSession;
}

/**
 * Gate for operator-only routes: the `platform:manage` permission, which the
 * `admin` platform role grants (see `data/permissions/core.perm` and
 * `platform.roles.ts`).
 *
 * It reads the actor off the envelope rather than the session because the roles
 * were already resolved once per request by `authorizationContextMiddleware`;
 * re-walking the tuple store per gated route would be the same answer at the
 * cost of a query.
 */
@Injectable()
export class PlatformManagePolicy extends Policy<RequirePolicyContext, ServerPolicyEnvelope> {
    async evaluate(_context: RequirePolicyContext, envelope: ServerPolicyEnvelope): Promise<PolicyResult> {
        const actor = envelope.actor;
        if (actor.kind === 'user' && rolesGrant(actor.platformRoles, PLATFORM_NAMESPACE, 'manage')) return this.allow();
        return this.deny('platform_manage_required', { kind: 'permission_required', permission: 'platform:manage' });
    }
}

export const ServerPolicyMappings: Record<AuthenticationPolicyNames | DeadairPolicyNames, Constructor<Policy>> = {
    'platform.manage': PlatformManagePolicy,
    'auth.factor.email.allowed': EmailAllowedPolicy,
    'auth.factor.phone.allowed': PhoneAllowedPolicy,
    'auth.factor.password.allowed': PasswordAllowedPolicy,
    'auth.factor.oidc.profile.allowed': OidcProfileAllowedPolicy,
    'auth.factor.oauth2.profile.allowed': OAuth2ProfileAllowedPolicy,
    'auth.session.recent.factor': AuthRecentFactorPolicy,
    'auth.session.mfa.required': AlwaysDenyPolicy,
    'auth.session.mfa.satisfied': AlwaysAllowPolicy,
    'auth.recovery.allowed': RecoveryAllowedPolicy,
    'auth.support.verification.allowed': SupportVerificationAllowedPolicy,
    'auth.session.assurance.level': DefaultAssuranceLevelPolicy,
};

export type ServerPolicyContexts = {
    'platform.manage': RequirePolicyContext;
    'auth.factor.email.allowed': EmailAllowedPolicyContext;
    'auth.factor.phone.allowed': PhoneAllowedPolicyContext;
    'auth.factor.password.allowed': PasswordAllowedPolicyContext;
    'auth.factor.oidc.profile.allowed': OidcProfileAllowedPolicyContext;
    'auth.factor.oauth2.profile.allowed': OAuth2ProfileAllowedPolicyContext;
    'auth.session.recent.factor': AuthRecentFactorPolicyContext;
    'auth.session.mfa.required': AuthMfaRequiredPolicyContext;
    'auth.session.mfa.satisfied': AuthMfaSatisfiedPolicyContext;
    'auth.recovery.allowed': RecoveryAllowedPolicyContext;
    'auth.session.assurance.level': AuthAssuranceLevelPolicyContext;
    'auth.support.verification.allowed': SupportVerificationAllowedPolicyContext;
};
