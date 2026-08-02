import { AuthRecentFactorPolicy, AuthRecentFactorPolicyContext } from './policies/auth.recent.factor.policy.js';
import { AuthMfaSatisfiedPolicy } from './policies/auth.mfa.satisfied.policy.js';
import { Constructor } from 'injectkit';
import { Policy } from '@maroonedsoftware/policies';
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

export const ServerPolicyMappings: Record<AuthenticationPolicyNames, Constructor<Policy>> = {
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
