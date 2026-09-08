import type {
    AuthenticationFactor,
    AuthenticationFactorMethod,
    AuthenticationTokenOutput,
    FactorChallengeStartRequest,
    FactorChallengeStartResponseOutput,
    StepUpStartRequest,
    StepUpStartResponseOutput,
} from './types/authentication.types.js';
import { reviveFactorChallengeStartResponseOutput, reviveStepUpStartResponseOutput } from './types/authentication.types.js';
import type {
    AuthenticationFactorRegistration,
    AuthenticationFactorRegistrationResponse,
    AuthenticationFactorRegistrationVerification,
} from './types/registration.types.js';
import { reviveAuthenticationFactorRegistrationResponse } from './types/registration.types.js';
import type { SdkFetch } from '../sdk-options.js';
import { bigIntReplacer, parseJson } from '../sdk-options.js';

/**
 * generated from [authentication.factor.ck](../../../../apps/api/data/contracts/authentication/authentication.factor.ck)
 */
export class AuthenticationFactorsClient {
    constructor(private fetch: SdkFetch) {}

    /**
     * @name List factors
     * @description List authentication factors
     */
    async listFactors(): Promise<AuthenticationFactor[]> {
        const result = await this.fetch(`/auth/factors`, { method: 'GET' });
        return await parseJson<AuthenticationFactor[]>(result);
    }

    /**
     * @name Register factor
     * @description Register an authentication factor
     */
    async registerFactor(body: AuthenticationFactorRegistration): Promise<AuthenticationFactorRegistrationResponse> {
        const result = await this.fetch(`/auth/factors/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return reviveAuthenticationFactorRegistrationResponse(await parseJson<AuthenticationFactorRegistrationResponse>(result));
    }

    /**
     * @name Verify factor registration
     * @description Verify an authentication factor registration
     */
    async verifyFactorRegistration(body: AuthenticationFactorRegistrationVerification): Promise<AuthenticationTokenOutput> {
        const result = await this.fetch(`/auth/factors/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return await parseJson<AuthenticationTokenOutput>(result);
    }

    /**
     * @name Start factor challenge
     * @description Issue a factor verification challenge for a pending MFA round. Authenticated via the short-lived `mfa_challenge_id` in the body, not by session — this is the only /auth/factors/* route that does not require an authenticated session.
     */
    async startFactorChallenge(body: FactorChallengeStartRequest): Promise<FactorChallengeStartResponseOutput> {
        const result = await this.fetch(`/auth/factors/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return reviveFactorChallengeStartResponseOutput(await parseJson<FactorChallengeStartResponseOutput>(result));
    }

    /**
     * @name Start MFA challenge
     * @description Mint a fresh MFA challenge for the *current* authenticated session so the SPA can satisfy a `step_up_required` denial. Optionally filters eligible factors against an inbound `StepUpRequirement` hint. Returns `enrollment_required` when no enrolled factor matches the requirement so the SPA can route the user into enrollment instead of getting stuck.
     */
    async startMFAChallenge(body: StepUpStartRequest): Promise<StepUpStartResponseOutput> {
        const result = await this.fetch(`/auth/mfa/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body, bigIntReplacer),
        });
        return reviveStepUpStartResponseOutput(await parseJson<StepUpStartResponseOutput>(result));
    }

    /**
     * @name Remove factor
     * @description Remove one of the caller's own factors. Answered only for `authenticator` today, and only after a recent strong-factor verification: the same gate enrolment sits behind once a strong factor exists, so a stolen session cannot quietly switch the second factor off. Removing the last authenticator turns the sign-in challenge off for that account.
     */
    async removeFactor(method: AuthenticationFactorMethod, methodId: string): Promise<void> {
        await this.fetch(`/auth/factors/${encodeURIComponent(method)}/${encodeURIComponent(methodId)}`, { method: 'DELETE' });
    }
}
