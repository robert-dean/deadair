import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { SdkError } from '@deadair/sdk';

import { RootLayout } from '../../src/routes/__root';
import { clearSession, isAuthenticated, setSession } from '../../src/auth/session.store';
import { createTestQueryClient, render, screen, setupUser, waitFor } from '../utils/render';

const navigate = vi.fn().mockResolvedValue(undefined);
const invalidate = vi.fn().mockResolvedValue(undefined);
const logout = vi.fn();
const readSession = vi.fn();

// The layout is exercised on its own: the router is stubbed down to the three pieces it renders with.
vi.mock('@tanstack/react-router', () => ({
    // Curried: `createRootRouteWithContext<T>()(options)`.
    createRootRouteWithContext: () => () => ({}),
    Link: ({ to, children, ...props }: { to?: string; children?: ReactNode }) => (
        <a href={to} {...props}>
            {children}
        </a>
    ),
    Outlet: () => <div data-testid="outlet" />,
    redirect: (options: unknown) => options,
    useNavigate: () => navigate,
    useRouter: () => ({ invalidate }),
    // The pinned footer asks the router where the operator is, to decide whether to open Settings
    // out into its sections. Answered as somewhere that is not Settings, which is what every case
    // in this file is about.
    useRouterState: ({ select }: { select: (state: { location: { pathname: string } }) => unknown }) => select({ location: { pathname: '/' } }),
}));

vi.mock('../../src/api/client', () => ({
    sdk: {
        authentication: {
            sessions: { logout: (...args: unknown[]) => logout(...args), readSession: () => readSession() },
            factors: { listFactors: async () => [] },
        },
    },
}));

function logoutButton() {
    return screen.getByRole('button', { name: 'Logout' });
}

beforeEach(() => {
    readSession.mockResolvedValue({ actorId: 'u-admin', roles: ['admin'] });
});

afterEach(() => {
    readSession.mockReset();
    navigate.mockClear();
    invalidate.mockClear();
    logout.mockReset();
    clearSession();
});

describe('RootLayout', () => {
    it('hides the nav and Logout while anonymous', () => {
        render(<RootLayout />);

        expect(screen.queryByRole('button', { name: 'Logout' })).not.toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'Desk' })).not.toBeInTheDocument();
    });

    it('shows the nav and Logout for a live session', async () => {
        setSession('token-123', 3600);
        render(<RootLayout />);

        expect(await screen.findByRole('button', { name: 'Logout' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Desk' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Library' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();
    });

    /**
     * The first Tab stop on every page, before the wordmark or a single destination. Drawn whether
     * or not a session exists, since an anonymous visitor's keyboard deserves the same shortcut past
     * whatever the header holds for them.
     */
    it('offers a skip link naming the main landmark it jumps to', () => {
        render(<RootLayout />);

        const skip = screen.getByRole('link', { name: 'Skip to content' });
        expect(skip).toHaveAttribute('href', '#main');
        expect(document.getElementById('main')).not.toBeNull();
    });

    // A desk left open after its session died polled 401s for 43 minutes, because the gate only ran
    // on the next navigation.
    it('asks the gate again the moment a live session ends, and not before', async () => {
        setSession('token-123', 3600);
        render(<RootLayout />);
        expect(invalidate).not.toHaveBeenCalled();

        act(() => clearSession());

        await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
    });

    it('does not ask again for a page that was never signed in', () => {
        render(<RootLayout />);

        expect(invalidate).not.toHaveBeenCalled();
    });

    it('hides them again for a token that exists but has expired', () => {
        setSession('token-123', -1);
        render(<RootLayout />);

        expect(screen.queryByRole('button', { name: 'Logout' })).not.toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'Desk' })).not.toBeInTheDocument();
    });

    it('clears the session and routes to /login on a successful logout, saying nothing failed', async () => {
        logout.mockResolvedValue(undefined);
        setSession('token-123', 3600);
        render(<RootLayout />);
        await screen.findByRole('button', { name: 'Logout' });

        await setupUser().click(logoutButton());

        await waitFor(() => {
            expect(navigate).toHaveBeenCalledWith({ to: '/login' });
        });
        expect(isAuthenticated()).toBe(false);
        expect(screen.queryByText('Sign-out incomplete')).not.toBeInTheDocument();
    });

    it('still signs out locally when the revoke fails, but surfaces the failure', async () => {
        logout.mockRejectedValue(new SdkError(500, 'Internal Server Error', { statusCode: 500, message: 'Revoke exploded' }, new Headers()));
        setSession('token-123', 3600);
        render(<RootLayout />);
        await screen.findByRole('button', { name: 'Logout' });

        await setupUser().click(logoutButton());

        expect(await screen.findByText('Sign-out incomplete')).toBeInTheDocument();
        expect(screen.getByText(/Revoke exploded/)).toBeInTheDocument();
        expect(isAuthenticated()).toBe(false);
        expect(navigate).toHaveBeenCalledWith({ to: '/login' });
    });

    it('empties the query cache on sign-out so the next user inherits nothing', async () => {
        logout.mockResolvedValue(undefined);
        setSession('token-123', 3600);
        const queryClient = createTestQueryClient();
        queryClient.setQueryData(['onboarding', 'requirements'], [{ key: 'admin.account' }]);
        render(<RootLayout />, { queryClient });
        await screen.findByRole('button', { name: 'Logout' });

        await setupUser().click(logoutButton());

        await waitFor(() => {
            expect(queryClient.getQueryData(['onboarding', 'requirements'])).toBeUndefined();
        });
    });

    it('empties the cache even when the revoke itself failed', async () => {
        logout.mockRejectedValue(new Error('offline'));
        setSession('token-123', 3600);
        const queryClient = createTestQueryClient();
        queryClient.setQueryData(['onboarding', 'requirements'], [{ key: 'admin.account' }]);
        render(<RootLayout />, { queryClient });
        await screen.findByRole('button', { name: 'Logout' });

        await setupUser().click(logoutButton());

        await waitFor(() => {
            expect(queryClient.getQueryData(['onboarding', 'requirements'])).toBeUndefined();
        });
    });

    it('lets the sign-out warning be dismissed', async () => {
        logout.mockRejectedValue(new Error('offline'));
        setSession('token-123', 3600);
        render(<RootLayout />);
        await screen.findByRole('button', { name: 'Logout' });

        const user = setupUser();
        await user.click(logoutButton());
        expect(await screen.findByText('Sign-out incomplete')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Dismiss' }));

        await waitFor(() => {
            expect(screen.queryByText('Sign-out incomplete')).not.toBeInTheDocument();
        });
    });

    describe('for somebody without the admin role', () => {
        it('draws their own account rather than the desk', async () => {
            readSession.mockResolvedValue({ actorId: 'u-friend', roles: ['listener'] });
            setSession('token-123', 3600);
            render(<RootLayout />);

            expect(await screen.findByRole('heading', { name: 'Your account' })).toBeInTheDocument();
            expect(screen.queryByRole('link', { name: 'Desk' })).not.toBeInTheDocument();
            expect(screen.getByRole('link', { name: 'Open the station in the deadair app' })).toBeInTheDocument();
        });

        it('treats an account holding no role at all the same way', async () => {
            readSession.mockRejectedValue(new SdkError(403, 'Forbidden', { statusCode: 403, message: 'Forbidden' }, new Headers()));
            setSession('token-123', 3600);
            render(<RootLayout />);

            expect(await screen.findByRole('heading', { name: 'Your account' })).toBeInTheDocument();
        });

        it('draws nothing of the desk while it is still asking who they are', () => {
            readSession.mockReturnValue(new Promise(() => undefined));
            setSession('token-123', 3600);
            render(<RootLayout />);

            expect(screen.queryByRole('link', { name: 'Desk' })).not.toBeInTheDocument();
            expect(screen.queryByRole('heading', { name: 'Your account' })).not.toBeInTheDocument();
        });

        it('keeps the desk for an admin when the station is only unwell', async () => {
            readSession.mockRejectedValue(new SdkError(502, 'Bad Gateway', { statusCode: 502, message: 'Bad Gateway' }, new Headers()));
            setSession('token-123', 3600);
            render(<RootLayout />);

            expect(await screen.findByRole('button', { name: 'Logout' })).toBeInTheDocument();
        });
    });
});
