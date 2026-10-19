// The passkey half of the second-factor panel. Pinned: a passkey is offered first where the browser
// can use one, only a press raises the prompt (Safari refuses one nobody asked for), the assertion
// is bound to the challenge the station issued for it, and a closed prompt says nothing.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChallengePanel } from '../../../src/components/auth/challenge.panel';
import { clearSession, getSession } from '../../../src/auth/session.store';
import { PasskeyCancelled } from '../../../src/auth/webauthn';
import { render, screen, setupUser } from '../../utils/render';

const requestToken = vi.fn();
const startFactorChallenge = vi.fn();
const assertPasskey = vi.fn();
const passkeyAvailable = vi.hoisted(() => ({ value: true }));

vi.mock('../../../src/api/client', () => ({
    sdk: {
        authentication: {
            requestToken: (...args: unknown[]) => requestToken(...args),
            factors: { startFactorChallenge: (...args: unknown[]) => startFactorChallenge(...args) },
        },
    },
}));

vi.mock('../../../src/auth/webauthn', async importOriginal => ({
    ...(await importOriginal<typeof import('../../../src/auth/webauthn')>()),
    passkeysAvailable: () => passkeyAvailable.value,
    assertPasskey: (...args: unknown[]) => assertPasskey(...args),
}));

afterEach(() => {
    requestToken.mockReset();
    startFactorChallenge.mockReset();
    assertPasskey.mockReset();
    passkeyAvailable.value = true;
    clearSession();
});

const PASSKEY = { method: 'fido', method_id: 'key-1', kind: 'possession', label: 'Laptop' };
const AUTHENTICATOR = { method: 'authenticator', method_id: 'totp-1', kind: 'possession', label: 'Phone' };
const CREDENTIAL = { id: 'cred-1', type: 'public-key', rawId: 'AQID', clientExtensionResults: {}, response: {} };

const draw = (factors: unknown[], onComplete = vi.fn()) => {
    render(
        <ChallengePanel
            challenge={{ result: 'mfa_required', challenge_id: 'mfa-1', expires_at: '2026-01-01T00:00:00.000Z', factors } as never}
            onComplete={onComplete}
            onExpired={vi.fn()}
            onStartOver={vi.fn()}
        />,
    );
    return onComplete;
};

describe('a challenge offering a passkey', () => {
    it('offers the passkey ahead of an authenticator, and raises no prompt until pressed', () => {
        draw([AUTHENTICATOR, PASSKEY]);

        expect(screen.getByRole('button', { name: 'Use your passkey' })).toBeInTheDocument();
        expect(startFactorChallenge).not.toHaveBeenCalled();
        expect(assertPasskey).not.toHaveBeenCalled();
    });

    it('binds the assertion to the challenge the station issued, and stores the session', async () => {
        startFactorChallenge.mockResolvedValue({ method: 'fido', fido_challenge_id: 'fido-1', assertion: { challenge: 'AQID' } });
        assertPasskey.mockResolvedValue(CREDENTIAL);
        requestToken.mockResolvedValue({ result: 'token', access_token: 'access', token_type: 'Bearer', expires_in: 900 });
        const user = setupUser();
        const onComplete = draw([PASSKEY]);

        await user.click(screen.getByRole('button', { name: 'Use your passkey' }));

        await vi.waitFor(() => expect(onComplete).toHaveBeenCalled());
        expect(startFactorChallenge).toHaveBeenCalledWith({ method: 'fido', mfa_challenge_id: 'mfa-1' });
        expect(requestToken).toHaveBeenCalledWith(
            { grant_type: 'fido', mfa_challenge_id: 'mfa-1', challenge_id: 'fido-1', credential: CREDENTIAL },
            { contentType: 'application/json' },
        );
        expect(getSession()?.accessToken).toBe('access');
    });

    it('says nothing when the prompt is closed', async () => {
        startFactorChallenge.mockResolvedValue({ method: 'fido', fido_challenge_id: 'fido-1', assertion: { challenge: 'AQID' } });
        assertPasskey.mockRejectedValue(new PasskeyCancelled());
        const user = setupUser();
        draw([PASSKEY]);

        await user.click(screen.getByRole('button', { name: 'Use your passkey' }));

        await vi.waitFor(() => expect(assertPasskey).toHaveBeenCalled());
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(requestToken).not.toHaveBeenCalled();
    });

    it('falls back to the authenticator where the browser cannot use a passkey', () => {
        passkeyAvailable.value = false;
        draw([AUTHENTICATOR, PASSKEY]);

        expect(screen.queryByRole('button', { name: 'Use your passkey' })).not.toBeInTheDocument();
        expect(screen.getByText('Authenticator code')).toBeInTheDocument();
    });
});
