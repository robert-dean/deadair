import type { AuthenticationTokenResponseOutput, MfaRequiredResponseOutput } from '@deadair/sdk';

import { sdk } from './client';
import { apiErrorMessage, sdkError } from './sdk.error';
import { setSession } from '../auth/session.store';

/**
 * What the console found in the URL it was sent back to.
 *
 * Two things arrive here and they are told apart by a prefix on the token, which is the convention
 * the API's OIDC callback already used: `oidc:<exchangeId>` is a one-time stash id from a finished
 * federated sign-in, and anything else is a magic-link token, which carries its `challenge_id`
 * beside it because a link crosses devices and has no verifier to resolve one from.
 */
export interface AuthCallbackQuery {
    token?: string;
    challenge_id?: string;
    error?: string;
    error_description?: string;
}

export type AuthCallbackOutcome =
    /** A session was minted and stored. */
    | { kind: 'signed-in' }
    /** The proof was good and the account wants a second factor before a session exists. */
    | { kind: 'challenge'; challenge: MfaRequiredResponseOutput }
    /** Nothing usable arrived, or the token was spent, expired, or refused. */
    | { kind: 'failed'; message: string; spent: boolean };

/**
 * A token that has already been used, or has expired.
 *
 * Worth its own wording because it is the common case rather than an error: a link is single-use,
 * and the two ways to arrive on a spent one are reloading the page and a mail scanner having
 * fetched it first. "That link has been used" is actionable; "Bad Request" is not.
 */
function isSpent(error: unknown): boolean {
    const status = sdkError(error)?.status;
    return status === 400 || status === 404 || status === 401;
}

/**
 * Redeem whatever the API sent the console back with.
 *
 * Never rejects. Every outcome is a thing the page draws, including the failures — this runs in a
 * route loader, and a loader that throws puts an error boundary in front of somebody who is one
 * click from being signed in.
 */
export async function completeAuthCallback(query: AuthCallbackQuery): Promise<AuthCallbackOutcome> {
    // The IdP's own refusal, handed back by the API rather than raised here. It arrives instead of
    // a token, so it is checked first.
    if (query.error) {
        return { kind: 'failed', message: query.error_description ?? 'That sign-in was refused.', spent: false };
    }
    if (!query.token) {
        return { kind: 'failed', message: 'That link is missing the part that proves who you are. Ask for a new one.', spent: false };
    }

    const oidcExchangeId = /^oidc:(.+)$/.exec(query.token)?.[1];

    if (oidcExchangeId === undefined && query.challenge_id === undefined) {
        return { kind: 'failed', message: 'That link is missing its challenge id. Ask for a new one.', spent: false };
    }

    try {
        const response: AuthenticationTokenResponseOutput = oidcExchangeId
            ? await sdk.authentication.requestToken({ grant_type: 'oidc', challenge_id: oidcExchangeId }, { contentType: 'application/json' })
            : await sdk.authentication.requestToken(
                  { grant_type: 'link', challenge_id: query.challenge_id!, link: query.token },
                  { contentType: 'application/json' },
              );

        // A 200 that stopped at a challenge, not a failure: the link proved the inbox and the
        // account wants a second factor as well.
        if (response.result === 'mfa_required') {
            return { kind: 'challenge', challenge: response };
        }

        setSession(response.access_token, response.expires_in);
        return { kind: 'signed-in' };
    } catch (caught) {
        return {
            kind: 'failed',
            message: isSpent(caught)
                ? 'That link has already been used, or it has expired. Ask for a new one.'
                : apiErrorMessage(caught, 'Could not finish signing you in. Try again.'),
            spent: isSpent(caught),
        };
    }
}
