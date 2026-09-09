// The email half of the second-factor panel. Until this existed the console filtered a challenge
// down to authenticators and told anyone holding an email factor that it "cannot present" it —
// which on a fresh install is every operator, since onboarding gives every account an email factor
// and the default policy offers it after a password.
//
// The two things worth pinning are that asking for the code is what SENDS it (so it happens on
// arrival rather than behind a button nobody knows to press), and that the code goes out on the
// `code` grant bound to the email challenge rather than on the `authenticator` grant bound to a
// method id.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChallengePanel } from '../../../src/components/auth/challenge.panel';
import { clearSession, getSession } from '../../../src/auth/session.store';
import { render, screen, setupUser } from '../../utils/render';

const requestToken = vi.fn();
const startFactorChallenge = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        authentication: {
            requestToken: (...args: unknown[]) => requestToken(...args),
            factors: { startFactorChallenge: (...args: unknown[]) => startFactorChallenge(...args) },
        },
    },
}));

afterEach(() => {
    requestToken.mockReset();
    startFactorChallenge.mockReset();
    clearSession();
});

const EMAIL_FACTOR = { method: 'email', method_id: 'email-1', kind: 'possession', label: 'a***@example.com' };
const AUTHENTICATOR_FACTOR = { method: 'authenticator', method_id: 'totp-1', kind: 'possession', label: 'Phone' };

const challengeOf = (factors: unknown[]) =>
    ({ result: 'mfa_required', challenge_id: 'mfa-1', expires_at: '2026-01-01T00:00:00.000Z', factors }) as never;

const noop = () => undefined;

const draw = (factors: unknown[], handlers: Partial<{ onComplete: () => void; onExpired: () => void; onStartOver: () => void }> = {}) =>
    render(
        <ChallengePanel
            challenge={challengeOf(factors)}
            onComplete={handlers.onComplete ?? noop}
            onExpired={handlers.onExpired ?? noop}
            onStartOver={handlers.onStartOver ?? noop}
        />,
    );

describe('a challenge offering an email factor', () => {
    it('asks the station to send a code as soon as it is shown, since there is nothing to type until it has', async () => {
        startFactorChallenge.mockResolvedValue({ method: 'email', email_challenge_id: 'email-challenge-1' });

        draw([EMAIL_FACTOR]);

        await vi.waitFor(() => {
            expect(startFactorChallenge).toHaveBeenCalledWith({ method: 'email', mfa_challenge_id: 'mfa-1' });
        });
    });

    it('says where the code went, using the masked label the API offered', async () => {
        startFactorChallenge.mockResolvedValue({ method: 'email', email_challenge_id: 'email-challenge-1' });

        draw([EMAIL_FACTOR]);

        expect(await screen.findByText(/a\*\*\*@example\.com/)).toBeInTheDocument();
    });

    it('submits on the code grant, bound to the email challenge rather than to a method id', async () => {
        startFactorChallenge.mockResolvedValue({ method: 'email', email_challenge_id: 'email-challenge-1' });
        requestToken.mockResolvedValue({ result: 'token', access_token: 'tok-2', expires_in: 3600 });
        draw([EMAIL_FACTOR]);
        await screen.findByText(/a\*\*\*@example\.com/);

        await setupUser().type(screen.getByLabelText('Emailed code'), '123456');

        await vi.waitFor(() => {
            expect(requestToken).toHaveBeenLastCalledWith(
                { grant_type: 'code', mfa_challenge_id: 'mfa-1', challenge_id: 'email-challenge-1', code: '123456' },
                { contentType: 'application/json' },
            );
        });
    });

    it('stores the session the code bought', async () => {
        startFactorChallenge.mockResolvedValue({ method: 'email', email_challenge_id: 'email-challenge-1' });
        requestToken.mockResolvedValue({ result: 'token', access_token: 'tok-2', expires_in: 3600 });
        draw([EMAIL_FACTOR]);
        await screen.findByText(/a\*\*\*@example\.com/);

        await setupUser().type(screen.getByLabelText('Emailed code'), '123456');

        await vi.waitFor(() => {
            expect(getSession().accessToken).toBe('tok-2');
        });
    });

    // The code cannot be checked against a challenge the station has not minted, and typing into a
    // field that will silently drop the answer is worse than a disabled one.
    it('will not take a code until the station has said it sent one', async () => {
        startFactorChallenge.mockReturnValue(new Promise(() => undefined));

        draw([EMAIL_FACTOR]);

        expect(await screen.findByLabelText('Emailed code')).toBeDisabled();
    });

    it('offers to send it again, and asks the station a second time when pressed', async () => {
        startFactorChallenge.mockResolvedValue({ method: 'email', email_challenge_id: 'email-challenge-1' });
        draw([EMAIL_FACTOR]);
        await screen.findByText(/a\*\*\*@example\.com/);

        await setupUser().click(screen.getByRole('button', { name: 'Send it again' }));

        await vi.waitFor(() => {
            expect(startFactorChallenge).toHaveBeenCalledTimes(2);
        });
    });

    // A station with no mail server configured answers 503 here, and it is not the operator's code
    // that was wrong — nothing was typed yet.
    it('reports a station that could not send the code as its own failure, not a bad code', async () => {
        startFactorChallenge.mockRejectedValue(new Error('Email is not configured.'));

        draw([EMAIL_FACTOR]);

        expect(await screen.findByText('No code sent')).toBeInTheDocument();
    });

    // Measured live rather than reasoned about: with the send held in a mutation, StrictMode's
    // double-invoke of the effect left the observer tracking nothing, so a 503 never landed and the
    // panel sat pending with the code field AND "Send it again" both disabled and no error shown.
    // Somebody in that state can neither sign in nor see why.
    it('lets the operator try again after a failed send, rather than sitting disabled forever', async () => {
        startFactorChallenge.mockRejectedValue(new Error('Email is not configured.'));
        draw([EMAIL_FACTOR]);
        await screen.findByText('No code sent');

        expect(screen.getByRole('button', { name: 'Send it again' })).toBeEnabled();

        startFactorChallenge.mockResolvedValue({ method: 'email', email_challenge_id: 'email-challenge-1' });
        await setupUser().click(screen.getByRole('button', { name: 'Send it again' }));

        expect(await screen.findByText(/a\*\*\*@example\.com/)).toBeInTheDocument();
        expect(screen.getByLabelText('Emailed code')).toBeEnabled();
    });
});

describe('a challenge offering both', () => {
    it('prefers the authenticator, which is already in the operator’s hand', async () => {
        draw([EMAIL_FACTOR, AUTHENTICATOR_FACTOR]);

        expect(await screen.findByLabelText('Authenticator code')).toBeInTheDocument();
        expect(startFactorChallenge).not.toHaveBeenCalled();
    });

    it('sends nothing until the operator actually picks email', async () => {
        startFactorChallenge.mockResolvedValue({ method: 'email', email_challenge_id: 'email-challenge-1' });
        draw([EMAIL_FACTOR, AUTHENTICATOR_FACTOR]);
        const user = setupUser();

        await user.click(await screen.findByRole('combobox', { name: 'Verify with' }));
        await user.click(await screen.findByRole('option', { name: 'a***@example.com' }));

        await vi.waitFor(() => {
            expect(startFactorChallenge).toHaveBeenCalledTimes(1);
        });
    });
});

describe('a challenge offering neither', () => {
    it('still says so plainly rather than drawing a field no code can satisfy', async () => {
        draw([{ method: 'fido', method_id: 'key-1', kind: 'possession' }]);

        expect(await screen.findByText(/cannot present/)).toBeInTheDocument();
        expect(screen.queryByLabelText('Emailed code')).not.toBeInTheDocument();
        expect(startFactorChallenge).not.toHaveBeenCalled();
    });
});
