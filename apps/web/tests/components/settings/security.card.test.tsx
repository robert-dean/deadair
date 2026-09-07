import { afterEach, describe, expect, it, vi } from 'vitest';
import { SdkError } from '@deadair/sdk';

import { SecurityCard } from '../../../src/components/settings/security.card';
import { clearSession, getSession } from '../../../src/auth/session.store';
import { render, screen, setupUser, waitFor } from '../../utils/render';

const listFactors = vi.fn();
const registerFactor = vi.fn();
const verifyFactorRegistration = vi.fn();
const removeFactor = vi.fn();
const startMFAChallenge = vi.fn();
const requestToken = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        authentication: {
            requestToken: (...args: unknown[]) => requestToken(...args),
            factors: {
                listFactors: (...args: unknown[]) => listFactors(...args),
                registerFactor: (...args: unknown[]) => registerFactor(...args),
                verifyFactorRegistration: (...args: unknown[]) => verifyFactorRegistration(...args),
                removeFactor: (...args: unknown[]) => removeFactor(...args),
                startMFAChallenge: (...args: unknown[]) => startMFAChallenge(...args),
            },
        },
    },
}));

afterEach(() => {
    for (const mock of [listFactors, registerFactor, verifyFactorRegistration, removeFactor, startMFAChallenge, requestToken]) mock.mockReset();
    clearSession();
});

const PASSWORD = { method: 'password', kind: 'knowledge', methodId: 'actor-1', label: 'password' };
const EMAIL = { method: 'email', kind: 'possession', methodId: 'email-1', label: 'a***@example.com' };
const PHONE = { method: 'authenticator', kind: 'possession', methodId: 'totp-1', label: 'Phone' };
const REGISTRATION = {
    method: 'authenticator',
    registrationId: 'reg-1',
    secret: 'JBSWY3DPEHPK3PXP',
    uri: 'otpauth://totp/x',
    qrCode: 'data:image/png;base64,AA==',
};
const TOKEN = { access_token: 'tok-2', expires_in: 900, token_type: 'Bearer', scope: '' };

const stepUpDenied = () =>
    new SdkError(
        403,
        'Forbidden',
        {
            statusCode: 403,
            message: 'Forbidden',
            details: { kind: 'step_up_required', stepUp: { within: 'PT5M', excludeMethods: ['email', 'password', 'oidc'] } },
        },
        new Headers(),
    );

describe('SecurityCard', () => {
    it('lists how the operator signs in, and says when there is no authenticator', async () => {
        listFactors.mockResolvedValue([PASSWORD, EMAIL]);
        render(<SecurityCard />);

        expect(await screen.findByText('Password')).toBeInTheDocument();
        expect(screen.getByText('Email, a***@example.com')).toBeInTheDocument();
        expect(screen.getByText(/No authenticator yet/)).toBeInTheDocument();
    });

    it('enrols an authenticator: shows the QR and the key, then the first code proves the scan', async () => {
        listFactors.mockResolvedValue([PASSWORD]);
        registerFactor.mockResolvedValue(REGISTRATION);
        verifyFactorRegistration.mockResolvedValue(TOKEN);
        render(<SecurityCard />);
        const user = setupUser();

        await user.type(await screen.findByLabelText('Label'), 'Phone');
        await user.click(screen.getByRole('button', { name: 'Show QR code' }));

        expect(await screen.findByAltText('Authenticator QR code')).toHaveAttribute('src', REGISTRATION.qrCode);
        expect(screen.getByText(REGISTRATION.secret)).toBeInTheDocument();
        expect(registerFactor).toHaveBeenCalledWith(expect.objectContaining({ method: 'authenticator', label: 'Phone' }));

        listFactors.mockResolvedValue([PASSWORD, PHONE]);
        await user.type(screen.getByLabelText('First code'), '123456');

        await waitFor(() => {
            expect(verifyFactorRegistration).toHaveBeenCalledWith(
                expect.objectContaining({ method: 'authenticator', registrationId: 'reg-1', code: '123456' }),
            );
        });
        expect(getSession().accessToken).toBe('tok-2');
        // The list is re-read and the enrolment form is back to its start.
        expect(await screen.findByText('Phone')).toBeInTheDocument();
        expect(screen.queryByAltText('Authenticator QR code')).not.toBeInTheDocument();
    });

    it('keeps the QR on screen and says so when the first code is refused', async () => {
        listFactors.mockResolvedValue([PASSWORD]);
        registerFactor.mockResolvedValue(REGISTRATION);
        verifyFactorRegistration.mockRejectedValue(new SdkError(401, 'Unauthorized', { statusCode: 401, message: 'Bad code' }, new Headers()));
        render(<SecurityCard />);
        const user = setupUser();

        await user.click(await screen.findByRole('button', { name: 'Show QR code' }));
        await user.type(await screen.findByLabelText('First code'), '000000');

        expect(await screen.findByText(/That code was not accepted/)).toBeInTheDocument();
        expect(screen.getByAltText('Authenticator QR code')).toBeInTheDocument();
        expect(getSession().accessToken).toBeUndefined();
    });

    it('removes an authenticator after asking', async () => {
        listFactors.mockResolvedValue([PASSWORD, PHONE]);
        removeFactor.mockResolvedValue(undefined);
        render(<SecurityCard />);
        const user = setupUser();

        await user.click(await screen.findByRole('button', { name: 'Remove' }));
        listFactors.mockResolvedValue([PASSWORD]);
        await user.click(screen.getAllByRole('button', { name: 'Remove' }).at(-1)!);

        await waitFor(() => {
            expect(removeFactor).toHaveBeenCalledWith('authenticator', 'totp-1');
        });
        expect(await screen.findByText(/No authenticator yet/)).toBeInTheDocument();
    });

    it('re-verifies with a code when the API asks, then removes', async () => {
        listFactors.mockResolvedValue([PASSWORD, PHONE]);
        removeFactor.mockRejectedValueOnce(stepUpDenied()).mockResolvedValueOnce(undefined);
        startMFAChallenge.mockResolvedValue({
            result: 'mfa_required',
            challenge_id: 'mfa-9',
            factors: [{ method: 'authenticator', method_id: 'totp-1', kind: 'possession', label: 'Phone' }],
        });
        requestToken.mockResolvedValue({ result: 'token', ...TOKEN });
        render(<SecurityCard />);
        const user = setupUser();

        await user.click(await screen.findByRole('button', { name: 'Remove' }));
        await user.click(screen.getAllByRole('button', { name: 'Remove' }).at(-1)!);

        // The first attempt was refused for want of a recent code; the dialog asks for one.
        expect(await screen.findByText('Confirm it is you')).toBeInTheDocument();
        await waitFor(() => {
            expect(startMFAChallenge).toHaveBeenCalledWith({ acceptableMethods: ['authenticator'] });
        });
        listFactors.mockResolvedValue([PASSWORD]);
        await user.type(await screen.findByLabelText('Authenticator code'), '123456');

        await waitFor(() => {
            expect(requestToken).toHaveBeenCalledWith({
                grant_type: 'authenticator',
                mfa_challenge_id: 'mfa-9',
                method_id: 'totp-1',
                code: '123456',
            });
        });
        // The rotated token is stored, and the removal runs once more against it.
        expect(getSession().accessToken).toBe('tok-2');
        await waitFor(() => {
            expect(removeFactor).toHaveBeenCalledTimes(2);
        });
        expect(await screen.findByText(/No authenticator yet/)).toBeInTheDocument();
    });

    it('leaves everything as it was when the re-verify dialog is cancelled', async () => {
        listFactors.mockResolvedValue([PASSWORD, PHONE]);
        removeFactor.mockRejectedValue(stepUpDenied());
        startMFAChallenge.mockResolvedValue({
            result: 'mfa_required',
            challenge_id: 'mfa-9',
            factors: [{ method: 'authenticator', method_id: 'totp-1', kind: 'possession' }],
        });
        render(<SecurityCard />);
        const user = setupUser();

        await user.click(await screen.findByRole('button', { name: 'Remove' }));
        await user.click(screen.getAllByRole('button', { name: 'Remove' }).at(-1)!);
        expect(await screen.findByText('Confirm it is you')).toBeInTheDocument();
        await user.click(screen.getAllByRole('button', { name: 'Cancel' }).at(-1)!);

        await waitFor(() => {
            expect(screen.queryByText('Confirm it is you')).not.toBeInTheDocument();
        });
        expect(removeFactor).toHaveBeenCalledTimes(1);
        expect(requestToken).not.toHaveBeenCalled();
        expect(screen.getByText('Phone')).toBeInTheDocument();
    });
});
