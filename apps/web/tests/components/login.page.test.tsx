import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { SdkError } from '@deadair/sdk';

import { LoginPage } from '../../src/components/login.page';
import { clearSession, getSession } from '../../src/auth/session.store';
import { render, screen } from '../utils/render';

const requestToken = vi.fn();
const navigate = vi.fn();

vi.mock('../../src/api/client', () => ({
    sdk: {
        authentication: {
            requestToken: (...args: unknown[]) => requestToken(...args),
        },
    },
}));

vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => navigate,
}));

afterEach(() => {
    requestToken.mockReset();
    navigate.mockReset();
    clearSession();
});

async function fillAndSubmit(email: string, password: string) {
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email'), email);
    await user.type(screen.getByLabelText('Password'), password);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('LoginPage', () => {
    it('stores the session and navigates to the validated redirect target on an issued token', async () => {
        requestToken.mockResolvedValue({ result: 'token', access_token: 'tok-1', expires_in: 3600 });
        render(<LoginPage redirect="/dashboard" />);

        await fillAndSubmit('admin@example.com', 'hunter2');

        await vi.waitFor(() => {
            expect(navigate).toHaveBeenCalledWith({ to: '/dashboard' });
        });
        expect(getSession().accessToken).toBe('tok-1');
    });

    it('navigates to / for an off-origin redirect value', async () => {
        requestToken.mockResolvedValue({ result: 'token', access_token: 'tok-1', expires_in: 3600 });
        render(<LoginPage redirect="https://evil.com" />);

        await fillAndSubmit('admin@example.com', 'hunter2');

        await vi.waitFor(() => {
            expect(navigate).toHaveBeenCalledWith({ to: '/' });
        });
    });

    it('shows the not-supported-yet message and stores nothing for mfa_required', async () => {
        requestToken.mockResolvedValue({ result: 'mfa_required' });
        render(<LoginPage />);

        await fillAndSubmit('admin@example.com', 'hunter2');

        expect(await screen.findByText(/second factor, which this build cannot complete yet/)).toBeInTheDocument();
        expect(navigate).not.toHaveBeenCalled();
        expect(getSession().accessToken).toBeUndefined();
    });

    it('shows the invalid-credentials message, not a field error, on a 401', async () => {
        requestToken.mockRejectedValue(new SdkError(401, 'Unauthorized', { statusCode: 401, message: 'Bad credentials' }, new Headers()));
        render(<LoginPage />);

        await fillAndSubmit('admin@example.com', 'hunter2');

        expect(await screen.findByText('Invalid email or password')).toBeInTheDocument();
        expect(navigate).not.toHaveBeenCalled();
    });
});
