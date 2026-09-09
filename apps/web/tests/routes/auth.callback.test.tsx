// The route a magic link and a finished federated sign-in both land on. Neither had anywhere to
// land: the API has been redirecting to `${SPA_BASE_URL}/auth/callback` for OIDC all along and the
// console had no such route, so a Google sign-in ended on a 404.
//
// Tested through the loader rather than the generated tree, the way the plugin route tests are.
// The loader is where the work happens on purpose — a token is single use, and an effect runs twice
// per mount under StrictMode, which would spend it before the second run could use it.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { SdkError } from '@deadair/sdk';

import { completeAuthCallback } from '../../src/api/auth.callback.queries';
import { clearSession, getSession } from '../../src/auth/session.store';

const requestToken = vi.fn();

vi.mock('../../src/api/client', () => ({
    sdk: { authentication: { requestToken: (...args: unknown[]) => requestToken(...args) } },
}));

afterEach(() => {
    requestToken.mockReset();
    clearSession();
});

const TOKEN = { result: 'token', access_token: 'tok-1', expires_in: 3600 };

describe('a magic link', () => {
    it('redeems the token against the challenge it arrived with', async () => {
        requestToken.mockResolvedValue(TOKEN);

        await completeAuthCallback({ token: 'magic-token', challenge_id: 'challenge-1' });

        expect(requestToken).toHaveBeenCalledWith(
            { grant_type: 'link', challenge_id: 'challenge-1', link: 'magic-token' },
            { contentType: 'application/json' },
        );
    });

    it('stores the session it bought', async () => {
        requestToken.mockResolvedValue(TOKEN);

        const outcome = await completeAuthCallback({ token: 'magic-token', challenge_id: 'challenge-1' });

        expect(outcome).toEqual({ kind: 'signed-in' });
        expect(getSession().accessToken).toBe('tok-1');
    });

    // A link is one factor. An account with an authenticator enrolled has not finished.
    it('hands back the challenge when the account wants a second factor as well', async () => {
        const challenge = { result: 'mfa_required', challenge_id: 'mfa-1', factors: [] };
        requestToken.mockResolvedValue(challenge);

        const outcome = await completeAuthCallback({ token: 'magic-token', challenge_id: 'challenge-1' });

        expect(outcome).toEqual({ kind: 'challenge', challenge });
        expect(getSession().accessToken).toBeUndefined();
    });

    it('refuses a link with no challenge id, which cannot be redeemed', async () => {
        const outcome = await completeAuthCallback({ token: 'magic-token' });

        expect(outcome).toMatchObject({ kind: 'failed' });
        expect(requestToken).not.toHaveBeenCalled();
    });
});

describe('a finished federated sign-in', () => {
    it('is told apart by the prefix on the token, and redeemed on the oidc grant', async () => {
        requestToken.mockResolvedValue(TOKEN);

        await completeAuthCallback({ token: 'oidc:exchange-1' });

        expect(requestToken).toHaveBeenCalledWith({ grant_type: 'oidc', challenge_id: 'exchange-1' }, { contentType: 'application/json' });
    });

    it('needs no challenge id, since the exchange id is the whole proof', async () => {
        requestToken.mockResolvedValue(TOKEN);

        const outcome = await completeAuthCallback({ token: 'oidc:exchange-1' });

        expect(outcome).toEqual({ kind: 'signed-in' });
    });
});

describe('a callback that cannot sign anybody in', () => {
    it('reports what the identity provider said when it refused', async () => {
        const outcome = await completeAuthCallback({ error: 'access_denied', error_description: 'You cancelled the sign-in.' });

        expect(outcome).toMatchObject({ kind: 'failed', message: 'You cancelled the sign-in.' });
        expect(requestToken).not.toHaveBeenCalled();
    });

    it('says so when nothing usable arrived at all', async () => {
        const outcome = await completeAuthCallback({});

        expect(outcome).toMatchObject({ kind: 'failed' });
    });

    // Single use, so reloading the page or a mail scanner having fetched it first both land here.
    // That is not an error the operator caused and it should not read like one.
    it('calls a spent link spent rather than reporting a status code', async () => {
        requestToken.mockRejectedValue(new SdkError(400, 'Bad Request', { statusCode: 400, message: 'Bad Request' }, new Headers()));

        const outcome = await completeAuthCallback({ token: 'magic-token', challenge_id: 'challenge-1' });

        expect(outcome).toMatchObject({ kind: 'failed', spent: true, message: expect.stringContaining('already been used') });
    });

    it('treats a station-side failure as a failure rather than a spent link', async () => {
        requestToken.mockRejectedValue(new SdkError(503, 'Service Unavailable', { statusCode: 503, message: 'Service Unavailable' }, new Headers()));

        const outcome = await completeAuthCallback({ token: 'magic-token', challenge_id: 'challenge-1' });

        expect(outcome).toMatchObject({ kind: 'failed', spent: false });
    });

    // The loader draws whatever comes back, so a rejection here would put an error boundary in
    // front of somebody one click from being signed in.
    it('never rejects, whatever happened', async () => {
        requestToken.mockRejectedValue(new Error('socket hang up'));

        await expect(completeAuthCallback({ token: 'magic-token', challenge_id: 'challenge-1' })).resolves.toMatchObject({ kind: 'failed' });
    });
});
