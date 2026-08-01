import { Injectable } from 'injectkit';
import { AuthMfaSatisfiedPolicyContext } from '@maroonedsoftware/authentication';
import { Policy, PolicyResult } from '@maroonedsoftware/policies';

@Injectable()
// Overrides the serverkit's `DefaultMfaSatisfiedPolicy` only to keep the
// custom `WWW-Authenticate` header on denial; the rule itself is the same:
// 2+ factors and not all of them `knowledge`. An earlier revision granted
// blanket MFA credit to any `oidc` factor on the theory that the IdP had
// already done 2FA upstream, but the standard OIDC id_token carries no
// verifiable MFA claim, so that was an unverified assumption. Treat OIDC
// like any other single `possession` factor: it needs a second factor.
export class AuthMfaSatisfiedPolicy extends Policy<AuthMfaSatisfiedPolicyContext> {
    async evaluate({ session }: AuthMfaSatisfiedPolicyContext): Promise<PolicyResult> {
        if (session.factors.length >= 2 && !session.factors.every(f => f.kind === 'knowledge')) return this.allow();
        return this.deny('mfa_required').withHeaders({ 'WWW-Authenticate': 'Bearer error="mfa_required"' });
    }
}
