import { AuthRecentFactorPolicy, AuthRecentFactorPolicyContext } from './policies/auth.recent.factor.policy.js';
import { Constructor } from 'injectkit';
import { Policy, PolicyResult } from '@maroonedsoftware/policies';
import {
    AuthenticationPolicyNames,
    AuthMfaRequiredPolicyContext,
    AuthMfaSatisfiedPolicyContext,
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
import { AlwaysAllowPolicy } from '@maroonedsoftware/policies';
import { AuthenticationSession } from '@maroonedsoftware/authentication';
import { Injectable } from 'injectkit';
import { PLATFORM_NAMESPACE, rolesGrant } from '#modules/permissions/platform.roles.js';
import { ServerPolicyEnvelope } from './policy.envelope.js';
import { DeadairMfaRequiredPolicy } from '#modules/authentication/mfa.required.policy.js';

/**
 * Policy names this application adds on top of the authentication library's.
 * A generated router opts a route in by naming one in its contract's
 * `security: { policy: ... }` block, which becomes `requirePolicy({ policy })`.
 */
export type DeadairPolicyNames = 'platform.manage' | 'platform.view';

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

/**
 * Gate for the read floor: the `platform:view` permission, which every
 * signed-in platform role (`listener` or `admin`) grants (see
 * `data/permissions/core.perm` and `platform.roles.ts`).
 *
 * It reads the actor off the envelope rather than the session because the roles
 * were already resolved once per request by `authorizationContextMiddleware`;
 * re-walking the tuple store per gated route would be the same answer at the
 * cost of a query.
 */
@Injectable()
export class PlatformViewPolicy extends Policy<RequirePolicyContext, ServerPolicyEnvelope> {
    async evaluate(_context: RequirePolicyContext, envelope: ServerPolicyEnvelope): Promise<PolicyResult> {
        const actor = envelope.actor;
        if (actor.kind === 'user' && rolesGrant(actor.platformRoles, PLATFORM_NAMESPACE, 'view')) return this.allow();
        return this.deny('platform_view_required', { kind: 'permission_required', permission: 'platform:view' });
    }
}

export const ServerPolicyMappings: Record<AuthenticationPolicyNames | DeadairPolicyNames, Constructor<Policy>> = {
    'platform.manage': PlatformManagePolicy,
    'platform.view': PlatformViewPolicy,
    'auth.factor.email.allowed': EmailAllowedPolicy,
    'auth.factor.phone.allowed': PhoneAllowedPolicy,
    'auth.factor.password.allowed': PasswordAllowedPolicy,
    'auth.factor.oidc.profile.allowed': OidcProfileAllowedPolicy,
    'auth.factor.oauth2.profile.allowed': OAuth2ProfileAllowedPolicy,
    'auth.session.recent.factor': AuthRecentFactorPolicy,
    // **A second factor is asked for at sign-in only by somebody who has enrolled one.** The
    // package's default rule filters the actor's enrolled factors down to those that can stand as
    // a SECOND factor (possession, not the one just used, not OIDC) and denies only when something
    // survives; `MfaOrchestrator.issueOrChallenge` mints a challenge on that denial and nothing
    // else. So an account holding a password alone signs in exactly as before, and an account that
    // has enrolled an authenticator is asked for its code. Opt-in per account, and the console's
    // Security page is where the opting happens.
    //
    // This used to be `AlwaysAllowPolicy`, on the argument that one operator on one install did not
    // want to be handed a code every time the console reloaded a plugin. That argument was about
    // codes on every REQUEST, which this does not cause: the challenge is raised once, at the
    // password grant, and the session it mints lasts a month behind the refresh cookie.
    //
    // `mfa.satisfied` is the other half and is left alone on purpose. Nothing evaluates it: it is
    // the koa package's DEFAULT_POLICY, used only for a bare `requirePolicy()`, and every one of
    // this app's contracts names its policy explicitly. Mapping the real one in would change
    // nothing today and would turn an omitted security block into an MFA gate tomorrow, which is
    // exactly the trap `authentication.ck` already warns about. Gating ROUTES on a second factor is
    // a separate decision from asking for one at sign-in, and it has not been taken.
    'auth.session.mfa.required': DeadairMfaRequiredPolicy,
    'auth.session.mfa.satisfied': AlwaysAllowPolicy,
    'auth.recovery.allowed': RecoveryAllowedPolicy,
    'auth.support.verification.allowed': SupportVerificationAllowedPolicy,
    'auth.session.assurance.level': DefaultAssuranceLevelPolicy,
};

export type ServerPolicyContexts = {
    'platform.manage': RequirePolicyContext;
    'platform.view': RequirePolicyContext;
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
