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
    // **Second factors are deliberately off, and these two are how.** One operator, one install, no
    // remote access — a station whose console is on the same machine as the mixer does not want to
    // be handed a code every time it reloads a plugin. Written down because a stub is otherwise
    // indistinguishable from unfinished wiring, and the real policy is sitting one directory away
    // in `policies/auth.mfa.satisfied.policy.ts` looking like it should be here.
    //
    // What each one currently costs, since they are not equivalent:
    //
    // `mfa.required` IS evaluated on every sign-in — `AuthenticationService` asks
    // `MfaOrchestrator.issueOrChallenge`, which mints a challenge only when the policy DENIES. So
    // allowing it makes the whole `mfa_challenge_id` path unreachable and every primary factor mint
    // a full session. Mapping `DefaultMfaRequiredPolicy` here would switch that path on for any
    // actor holding a viable second factor; the routes and contracts for it already exist.
    //
    // `mfa.satisfied` is evaluated by NOTHING today. It is the koa package's DEFAULT_POLICY, used
    // only for a bare `requirePolicy()`, and every one of this app's ~107 call sites names its
    // policy explicitly. Wiring `AuthMfaSatisfiedPolicy` in would therefore change no behaviour
    // until a contract omitted its security block — which is exactly the trap
    // `authentication.ck` already warns about, since an omitted block is not public.
    'auth.session.mfa.required': AlwaysAllowPolicy,
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
