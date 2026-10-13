// The invite page end to end against a stubbed station. The one rule worth more than the rest: nothing
// is asked of the station until the person presses something, so a mail scanner or a link preview that
// opens the link spends nothing.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import { SdkError } from '@deadair/sdk';

import { InviteApp } from '../../src/invite/invite.app';
import { render, screen, setupUser } from '../utils/render';

const readInvitation = vi.fn();
const startAcceptingInvitation = vi.fn();
const acceptInvitation = vi.fn();

vi.mock('../../src/invite/invite.client', () => ({
    inviteSdk: {
        users: {
            invitations: {
                readInvitation: (...args: unknown[]) => readInvitation(...args),
                startAcceptingInvitation: (...args: unknown[]) => startAcceptingInvitation(...args),
                acceptInvitation: (...args: unknown[]) => acceptInvitation(...args),
            },
        },
    },
}));

const DETAILS = { email: 'sam@friends.test', role: 'listener', stationName: 'Night Owl FM', expiresAt: DateTime.utc().plus({ days: 7 }) };
const PASSWORD = 'correct horse battery staple';

const refusal = (status: number, details?: Record<string, unknown>) =>
    new SdkError(status, 'Refused', { statusCode: status, message: 'Refused', ...(details ? { details } : {}) }, new Headers());

afterEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, '', '/invite');
});

const open = async (user: ReturnType<typeof setupUser>) => {
    readInvitation.mockResolvedValue(DETAILS);
    await user.click(await screen.findByRole('button', { name: 'Accept the invitation' }));
    await screen.findByText(/You are invited to listen to Night Owl FM/);
};

describe('the invite page', () => {
    it('asks the station nothing on arrival, and tidies the token out of the address', () => {
        window.history.replaceState(null, '', '/invite#di_abc');

        render(<InviteApp />);

        expect(screen.getByRole('button', { name: 'Accept the invitation' })).toBeInTheDocument();
        expect(readInvitation).not.toHaveBeenCalled();
        expect(startAcceptingInvitation).not.toHaveBeenCalled();
        expect(window.location.hash).toBe('');
    });

    it('says the link is incomplete when there is no token', () => {
        render(<InviteApp />);
        expect(screen.getByText('This link is incomplete')).toBeInTheDocument();
    });

    it('says so plainly when the invitation is no longer open', async () => {
        window.history.replaceState(null, '', '/invite#di_used');
        readInvitation.mockRejectedValue(refusal(404));
        const user = setupUser();
        render(<InviteApp />);

        await user.click(screen.getByRole('button', { name: 'Accept the invitation' }));

        expect(await screen.findByText('This invitation is not open')).toBeInTheDocument();
    });

    it("shows the invited address fixed, and the station's reason for a weak password", async () => {
        window.history.replaceState(null, '', '/invite#di_abc');
        startAcceptingInvitation.mockRejectedValue(refusal(400, { password: 'This is a very common password' }));
        const user = setupUser();
        render(<InviteApp />);
        await open(user);

        expect(screen.getByDisplayValue('sam@friends.test')).toHaveAttribute('readonly');
        await user.type(screen.getByLabelText('Choose a password'), 'password');
        await user.type(screen.getByLabelText('The same password again'), 'password');
        await user.click(screen.getByRole('button', { name: 'Continue' }));

        expect(await screen.findByText('This is a very common password')).toBeInTheDocument();
    });

    it('makes the account with an authenticator code, then points a listener at the app', async () => {
        window.history.replaceState(null, '', '/invite#di_abc');
        startAcceptingInvitation.mockResolvedValue({
            method: 'authenticator',
            registrationId: 'reg-1',
            secret: 'SECRETKEY',
            uri: 'otpauth://x',
            qrCode: 'data:image/png;base64,',
        });
        acceptInvitation.mockResolvedValue({ email: 'sam@friends.test', role: 'listener' });
        const user = setupUser();
        render(<InviteApp />);
        await open(user);

        await user.type(screen.getByLabelText('Choose a password'), PASSWORD);
        await user.type(screen.getByLabelText('The same password again'), PASSWORD);
        await user.click(screen.getByRole('button', { name: 'Continue' }));
        expect(startAcceptingInvitation).toHaveBeenCalledWith({ token: 'di_abc', password: PASSWORD, method: 'authenticator' });

        expect(await screen.findByText('SECRETKEY')).toBeInTheDocument();
        await user.type(screen.getByLabelText('First code'), '123456');

        expect(await screen.findByText('You are in')).toBeInTheDocument();
        expect(acceptInvitation).toHaveBeenCalledWith({
            method: 'authenticator',
            token: 'di_abc',
            password: PASSWORD,
            registrationId: 'reg-1',
            code: '123456',
        });
        expect(screen.getByRole('link', { name: 'Open the station in the deadair app' })).toHaveAttribute(
            'href',
            `deadair://connect?station=${encodeURIComponent(window.location.origin)}`,
        );
    });

    it('keeps the person on the code screen when a code is refused, with the invitation still open', async () => {
        window.history.replaceState(null, '', '/invite#di_abc');
        startAcceptingInvitation.mockResolvedValue({
            method: 'authenticator',
            registrationId: 'reg-1',
            secret: 'SECRETKEY',
            uri: 'otpauth://x',
            qrCode: 'data:image/png;base64,',
        });
        acceptInvitation.mockRejectedValue(refusal(401));
        const user = setupUser();
        render(<InviteApp />);
        await open(user);
        await user.type(screen.getByLabelText('Choose a password'), PASSWORD);
        await user.type(screen.getByLabelText('The same password again'), PASSWORD);
        await user.click(screen.getByRole('button', { name: 'Continue' }));
        await screen.findByText('SECRETKEY');

        await user.type(screen.getByLabelText('First code'), '000000');

        expect(await screen.findByText('That code was not accepted. Wait for the next one and try again.')).toBeInTheDocument();
        expect(screen.getByLabelText('First code')).toBeInTheDocument();
    });

    it('will not continue while the two passwords differ', async () => {
        window.history.replaceState(null, '', '/invite#di_abc');
        const user = setupUser();
        render(<InviteApp />);
        await open(user);

        await user.type(screen.getByLabelText('Choose a password'), PASSWORD);
        await user.type(screen.getByLabelText('The same password again'), `${PASSWORD}!`);

        expect(screen.getByText('The two passwords are not the same.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    });
});
