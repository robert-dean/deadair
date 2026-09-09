import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
    AuthenticationFactorMethod,
    AuthenticationTokenResponseOutput,
    MfaChallengeFactorOutput,
    StepUpStartResponseOutput,
} from '@deadair/sdk';

import { generateCodeChallenge, generateCodeVerifier } from '../auth/pkce';
import { setSession } from '../auth/session.store';
import { sdk } from './client';
import { queryKeys } from './query.keys';

/**
 * How the operator signs in, and the two things that change it: enrolling an authenticator and
 * removing one. Every mutation here is `retry: false` for the reason `auth.mutations.ts` gives:
 * a refused code is a verdict, and a rate limit is a wait the page should report rather than sit
 * through behind the operator's back.
 */

export const factorsOptions = queryOptions({
    queryKey: queryKeys.auth.factors(),
    queryFn: () => sdk.authentication.factors.listFactors(),
});

/** Every factor on the signed-in account. */
export function useFactors() {
    return useQuery(factorsOptions);
}

/** What the API handed back for a pending enrolment, plus the verifier only this browser holds. */
export interface AuthenticatorRegistration {
    registrationId: string;
    /** For typing into an app that cannot scan. */
    secret: string;
    /** The `otpauth://` URI the QR code encodes. */
    uri: string;
    /** A data URL, drawn straight into an `<img>`. */
    qrCode: string;
    /** Sent back with the first code; see `auth/pkce.ts`. */
    codeVerifier: string;
}

/**
 * Starts enrolling an authenticator: the API mints a secret and answers with the QR code.
 *
 * The verifier is minted here and travels with the result rather than living in a store, because
 * it belongs to exactly one enrolment and dies with it. The API keeps a pending registration for
 * a while and answers the same QR to a repeat call, so a re-render is not a new secret.
 */
export function useRegisterAuthenticator() {
    return useMutation({
        retry: false,
        mutationFn: async ({ label }: { label?: string }): Promise<AuthenticatorRegistration> => {
            const codeVerifier = generateCodeVerifier();
            const codeChallenge = await generateCodeChallenge(codeVerifier);
            const trimmed = label?.trim();
            const response = await sdk.authentication.factors.registerFactor({
                method: 'authenticator',
                codeChallenge,
                ...(trimmed ? { label: trimmed } : {}),
            });
            if (response.method !== 'authenticator') {
                throw new Error(`Expected an authenticator registration, got ${response.method}`);
            }
            return {
                registrationId: response.registrationId,
                secret: response.secret,
                uri: response.uri,
                qrCode: response.qrCode,
                codeVerifier,
            };
        },
    });
}

/**
 * Finishes enrolling: the first code the app shows proves the scan worked, and the API answers
 * with a fresh token whose session now carries the authenticator as a verified factor. Storing
 * that token is what lets a second enrolment or a removal pass the recent-factor gate for the
 * next five minutes without a separate step-up.
 */
export function useVerifyAuthenticator() {
    const queryClient = useQueryClient();
    return useMutation({
        retry: false,
        mutationFn: ({ registrationId, code, codeVerifier }: { registrationId: string; code: string; codeVerifier: string }) =>
            sdk.authentication.factors.verifyFactorRegistration({ method: 'authenticator', registrationId, code, codeVerifier }),
        onSuccess: token => {
            setSession(token.access_token, token.expires_in);
            void queryClient.invalidateQueries({ queryKey: queryKeys.auth.factors() });
        },
    });
}

/**
 * Removes a factor. Answers 403 with a step-up requirement when the session's strong factor is
 * older than the gate allows; the caller reads that with `stepUpRequirement()` and re-verifies.
 */
export function useRemoveFactor() {
    const queryClient = useQueryClient();
    return useMutation({
        retry: false,
        mutationFn: ({ method, methodId }: { method: AuthenticationFactorMethod; methodId: string }) =>
            sdk.authentication.factors.removeFactor(method, methodId),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.auth.factors() });
        },
    });
}

/** A pending challenge, whether it came from a sign-in that stopped or from a step-up. */
export interface MfaChallenge {
    challengeId: string;
    factors: MfaChallengeFactorOutput[];
}

/** The factors on a challenge this console can present, which is the authenticator ones. */
export function authenticatorFactors(challenge: MfaChallenge): MfaChallengeFactorOutput[] {
    return challenge.factors.filter(factor => factor.method === 'authenticator');
}

/**
 * The methods this console can actually put a field in front of somebody for.
 *
 * Authenticators first, and the order is the recommendation: a code from an app is already on the
 * operator's phone, while an emailed one is a round trip through a mail server that may or may not
 * be configured. An account with both is offered the app.
 *
 * A challenge listing neither is a real state — a passkey enrolled through the API — and the panel
 * says so rather than drawing a field no code can satisfy.
 */
export function presentableFactors(challenge: MfaChallenge): MfaChallengeFactorOutput[] {
    const rank = (method: string): number => (method === 'authenticator' ? 0 : 1);
    return challenge.factors.filter(factor => factor.method === 'authenticator' || factor.method === 'email').sort((a, b) => rank(a.method) - rank(b.method));
}

/**
 * Asks the API to send a one-time code to the email factor on a pending challenge.
 *
 * Answers the `email_challenge_id` the code grant has to echo back. Deliberately not cached and
 * deliberately re-runnable: calling it again is the operator pressing "send it again", and the API
 * re-sends the same code rather than suppressing it.
 */
export function useStartEmailChallenge() {
    return useMutation({
        retry: false,
        mutationFn: async ({ challengeId }: { challengeId: string }) => {
            const response = await sdk.authentication.factors.startFactorChallenge({ method: 'email', mfa_challenge_id: challengeId });
            if (response.method !== 'email') throw new Error('The station answered with a factor this console did not ask for.');
            return response;
        },
    });
}

/**
 * Submits an emailed code against a pending challenge.
 *
 * The sibling of {@link useMfaCodeMutation} and a different grant: an authenticator code is bound
 * to the enrolled factor by `method_id`, while an emailed one is bound to the challenge the API
 * issued when it sent the message, which is what `challenge_id` carries. Stores the session on
 * `token` for the same reason its sibling does.
 */
export function useEmailCodeMutation() {
    return useMutation({
        retry: false,
        mutationFn: ({ challengeId, emailChallengeId, code }: { challengeId: string; emailChallengeId: string; code: string }) =>
            sdk.authentication.requestToken(
                { grant_type: 'code', mfa_challenge_id: challengeId, challenge_id: emailChallengeId, code },
                { contentType: 'application/json' },
            ),
        onSuccess: (response: AuthenticationTokenResponseOutput) => {
            if (response.result === 'token') {
                setSession(response.access_token, response.expires_in);
            }
        },
    });
}

/**
 * Submits an authenticator code against a pending challenge.
 *
 * One mutation serves both halves of the feature. At sign-in the challenge came back from the
 * password grant and the token that lands here is the session. In a step-up the caller is
 * already signed in, and the API rotates the current session onto the new token rather than
 * minting a second one; storing it is what retires the pre-elevation token in this tab.
 *
 * Resolves the raw response: the API is allowed to answer `mfa_required` again in principle, and
 * a caller that treats that as success would navigate into a shell that then 401s.
 */
export function useMfaCodeMutation() {
    return useMutation({
        retry: false,
        mutationFn: ({ challengeId, methodId, code }: { challengeId: string; methodId: string; code: string }) =>
            sdk.authentication.requestToken({ grant_type: 'authenticator', mfa_challenge_id: challengeId, method_id: methodId, code }),
        onSuccess: (response: AuthenticationTokenResponseOutput) => {
            if (response.result === 'token') {
                setSession(response.access_token, response.expires_in);
            }
        },
    });
}

/**
 * Mints a challenge for the current session so the operator can re-verify with their
 * authenticator. `enrollment_required` comes back when there is none to verify with, which the
 * caller decides what to do about; this console only ever asks when one is enrolled.
 */
export function useStartStepUp() {
    return useMutation({
        retry: false,
        mutationFn: (): Promise<StepUpStartResponseOutput> => sdk.authentication.factors.startMFAChallenge({ acceptableMethods: ['authenticator'] }),
    });
}
