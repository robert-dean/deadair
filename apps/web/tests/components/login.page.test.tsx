import { afterEach, describe, expect, it, vi } from 'vitest';
import { SdkError } from '@deadair/sdk';

import { LoginPage } from '../../src/components/login.page';
import { clearSession, getSession } from '../../src/auth/session.store';
import { render, screen, setupUser } from '../utils/render';

const requestToken = vi.fn();
const navigate = vi.fn();
const listSignInProviders = vi.fn(async (): Promise<unknown[]> => []);
const startLogin = vi.fn();

vi.mock('../../src/api/client', () => ({
    sdk: {
        authentication: {
            requestToken: (...args: unknown[]) => requestToken(...args),
            listSignInProviders: () => listSignInProviders(),
            startLogin: (...args: unknown[]) => startLogin(...args),
        },
    },
}));

vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => navigate,
}));

afterEach(() => {
    requestToken.mockReset();
    navigate.mockReset();
    listSignInProviders.mockReset();
    listSignInProviders.mockResolvedValue([]);
    startLogin.mockReset();
    vi.unstubAllGlobals();
    clearSession();
});

async function fillAndSubmit(email: string, password: string) {
    const user = setupUser();
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
            expect(navigate).toHaveBeenCalledWith({ href: '/dashboard' });
        });
        expect(getSession().accessToken).toBe('tok-1');
    });

    it('navigates to / for an off-origin redirect value', async () => {
        requestToken.mockResolvedValue({ result: 'token', access_token: 'tok-1', expires_in: 3600 });
        render(<LoginPage redirect="https://evil.com" />);

        await fillAndSubmit('admin@example.com', 'hunter2');

        await vi.waitFor(() => {
            expect(navigate).toHaveBeenCalledWith({ href: '/' });
        });
    });

    describe('a sign-in that stops at a second factor', () => {
        const CHALLENGE = {
            result: 'mfa_required',
            challenge_id: 'mfa-1',
            factors: [{ method: 'authenticator', method_id: 'totp-1', kind: 'possession', label: 'Phone' }],
        };

        /** The password grant answers the challenge; whatever comes next answers the code. */
        function challengeThen(afterCode: unknown) {
            requestToken.mockImplementation((body: { grant_type: string }) =>
                body.grant_type === 'password'
                    ? Promise.resolve(CHALLENGE)
                    : afterCode instanceof Error
                      ? Promise.reject(afterCode)
                      : Promise.resolve(afterCode),
            );
        }

        it('asks for the code, and stores nothing until it is accepted', async () => {
            challengeThen({ result: 'token', access_token: 'tok-2', expires_in: 3600 });
            render(<LoginPage redirect="/dashboard" />);

            await fillAndSubmit('admin@example.com', 'hunter2');

            expect(await screen.findByLabelText('Authenticator code')).toBeInTheDocument();
            expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
            expect(navigate).not.toHaveBeenCalled();
            expect(getSession().accessToken).toBeUndefined();
        });

        it('submits the code against the challenge and the factor it named, then stores the token and navigates', async () => {
            challengeThen({ result: 'token', access_token: 'tok-2', expires_in: 3600 });
            render(<LoginPage redirect="/dashboard" />);
            await fillAndSubmit('admin@example.com', 'hunter2');
            const user = setupUser();

            await user.type(await screen.findByLabelText('Authenticator code'), '123456');

            await vi.waitFor(() => {
                expect(navigate).toHaveBeenCalledWith({ href: '/dashboard' });
            });
            expect(requestToken).toHaveBeenLastCalledWith({
                grant_type: 'authenticator',
                mfa_challenge_id: 'mfa-1',
                method_id: 'totp-1',
                code: '123456',
            });
            expect(getSession().accessToken).toBe('tok-2');
            // The sixth digit submits and the button must not submit again behind it.
            expect(requestToken).toHaveBeenCalledTimes(2);
        });

        it('keeps the panel and says so when the code is refused', async () => {
            challengeThen(
                new SdkError(
                    401,
                    'Unauthorized',
                    { statusCode: 401, message: 'Bad code' },
                    new Headers({ 'WWW-Authenticate': 'Bearer error="invalid_grant"' }),
                ),
            );
            render(<LoginPage />);
            await fillAndSubmit('admin@example.com', 'hunter2');
            const user = setupUser();

            await user.type(await screen.findByLabelText('Authenticator code'), '000000');

            expect(await screen.findByText(/That code was not accepted/)).toBeInTheDocument();
            expect(screen.getByLabelText('Authenticator code')).toBeInTheDocument();
            expect(navigate).not.toHaveBeenCalled();
        });

        it("reports the server's wait when codes are being tried too fast", async () => {
            challengeThen(new SdkError(429, 'Too Many Requests', { statusCode: 429, message: 'Slow down' }, new Headers({ 'retry-after': '30' })));
            render(<LoginPage />);
            await fillAndSubmit('admin@example.com', 'hunter2');
            const user = setupUser();

            await user.type(await screen.findByLabelText('Authenticator code'), '000000');

            expect(await screen.findByText('Too many attempts. Try again in 30 seconds.')).toBeInTheDocument();
        });

        it('goes back to the password step when the challenge has expired', async () => {
            challengeThen(
                new SdkError(
                    401,
                    'Unauthorized',
                    { statusCode: 401, message: 'Gone' },
                    new Headers({ 'WWW-Authenticate': 'Bearer error="invalid_challenge"' }),
                ),
            );
            render(<LoginPage />);
            await fillAndSubmit('admin@example.com', 'hunter2');
            const user = setupUser();

            await user.type(await screen.findByLabelText('Authenticator code'), '000000');

            expect(await screen.findByText(/That sign-in timed out/)).toBeInTheDocument();
            expect(screen.getByLabelText('Password')).toBeInTheDocument();
            expect(screen.queryByLabelText('Authenticator code')).not.toBeInTheDocument();
        });

        it('lets the operator say which authenticator when more than one is enrolled', async () => {
            requestToken.mockImplementation((body: { grant_type: string }) =>
                body.grant_type === 'password'
                    ? Promise.resolve({
                          ...CHALLENGE,
                          factors: [...CHALLENGE.factors, { method: 'authenticator', method_id: 'totp-2', kind: 'possession', label: 'Tablet' }],
                      })
                    : Promise.resolve({ result: 'token', access_token: 'tok-2', expires_in: 3600 }),
            );
            render(<LoginPage />);
            await fillAndSubmit('admin@example.com', 'hunter2');
            const user = setupUser();

            const picker = await screen.findByRole('combobox', { name: 'Verify with' });
            await user.click(picker);
            await user.click(await screen.findByRole('option', { name: 'Tablet' }));
            await user.type(screen.getByLabelText('Authenticator code'), '123456');

            await vi.waitFor(() => {
                expect(requestToken).toHaveBeenLastCalledWith(expect.objectContaining({ grant_type: 'authenticator', method_id: 'totp-2' }));
            });
        });

        it('says plainly when the only factors offered are ones this console cannot present', async () => {
            requestToken.mockResolvedValue({ ...CHALLENGE, factors: [{ method: 'fido', method_id: 'key-1', kind: 'possession' }] });
            render(<LoginPage />);

            await fillAndSubmit('admin@example.com', 'hunter2');

            expect(await screen.findByText(/cannot present/)).toBeInTheDocument();
            expect(screen.queryByLabelText('Authenticator code')).not.toBeInTheDocument();
            expect(getSession().accessToken).toBeUndefined();
        });

        it('returns to the password step on start over', async () => {
            challengeThen({ result: 'token', access_token: 'tok-2', expires_in: 3600 });
            render(<LoginPage />);
            await fillAndSubmit('admin@example.com', 'hunter2');
            const user = setupUser();

            await user.click(await screen.findByRole('button', { name: 'Start over' }));

            expect(screen.getByLabelText('Password')).toBeInTheDocument();
        });
    });

    it('shows the invalid-credentials message, not a field error, on a 401', async () => {
        requestToken.mockRejectedValue(new SdkError(401, 'Unauthorized', { statusCode: 401, message: 'Bad credentials' }, new Headers()));
        render(<LoginPage />);

        await fillAndSubmit('admin@example.com', 'hunter2');

        expect(await screen.findByText('Invalid email or password')).toBeInTheDocument();
        expect(navigate).not.toHaveBeenCalled();
    });

    it('puts server-side validation messages on the matching fields', async () => {
        requestToken.mockRejectedValue(
            new SdkError(
                422,
                'Unprocessable Entity',
                { statusCode: 422, message: 'Invalid', details: { email: 'Not a known address' } },
                new Headers(),
            ),
        );
        render(<LoginPage />);

        await fillAndSubmit('admin@example.com', 'hunter2');

        expect(await screen.findByText('Not a known address')).toBeInTheDocument();
    });

    it("reports the server's own wait rather than retrying a rate-limited sign-in", async () => {
        requestToken.mockRejectedValue(
            new SdkError(429, 'Too Many Requests', { statusCode: 429, message: 'Slow down' }, new Headers({ 'retry-after': '12' })),
        );
        render(<LoginPage />);

        await fillAndSubmit('admin@example.com', 'hunter2');

        expect(await screen.findByText('Too many attempts. Try again in 12 seconds.')).toBeInTheDocument();
        // Replaying a sign-in behind the user's back is worse than telling them to wait.
        expect(requestToken).toHaveBeenCalledTimes(1);
    });

    it('falls back to a generic message when a rate limit carries no retry-after', async () => {
        requestToken.mockRejectedValue(new SdkError(429, 'Too Many Requests', { statusCode: 429, message: 'Slow down' }, new Headers()));
        render(<LoginPage />);

        await fillAndSubmit('admin@example.com', 'hunter2');

        expect(await screen.findByText('Too many attempts. Wait a moment and try again.')).toBeInTheDocument();
    });
});

describe('LoginPage identity providers', () => {
    it('offers no provider button on a station that has none', async () => {
        render(<LoginPage />);

        await vi.waitFor(() => expect(listSignInProviders).toHaveBeenCalled());
        expect(screen.queryByRole('button', { name: /Continue with/ })).toBeNull();
    });

    it('offers one button per provider, labelled as the operator named it', async () => {
        listSignInProviders.mockResolvedValue([
            { name: 'authelia', label: 'Authelia' },
            { name: 'google', label: 'Google' },
        ]);
        render(<LoginPage />);

        expect(await screen.findByRole('button', { name: 'Continue with Authelia' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeTruthy();
    });

    it('starts the sign-in with the sanitised return path and goes to the provider', async () => {
        const assign = vi.fn();
        vi.stubGlobal('location', { ...window.location, assign });
        listSignInProviders.mockResolvedValue([{ name: 'authelia', label: 'Authelia' }]);
        startLogin.mockResolvedValue({ grant_type: 'oidc', authorize_url: 'https://auth.example.com/authorize?x=1', state: 's' });
        render(<LoginPage redirect="https://evil.com" />);

        await setupUser().click(await screen.findByRole('button', { name: 'Continue with Authelia' }));

        await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('https://auth.example.com/authorize?x=1'));
        expect(startLogin).toHaveBeenCalledWith({ grant_type: 'oidc', provider: 'authelia', redirect_after: '/' });
    });

    it('says so when the provider could not be reached', async () => {
        listSignInProviders.mockResolvedValue([{ name: 'authelia', label: 'Authelia' }]);
        startLogin.mockRejectedValue(new Error('offline'));
        render(<LoginPage />);

        await setupUser().click(await screen.findByRole('button', { name: 'Continue with Authelia' }));

        expect(await screen.findByText('Could not start that sign-in')).toBeTruthy();
    });
});
