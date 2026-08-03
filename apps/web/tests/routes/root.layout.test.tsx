import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { SdkError } from '@deadair/sdk';

import { RootLayout } from '../../src/routes/__root';
import { clearSession, isAuthenticated, setSession } from '../../src/auth/session.store';
import { createTestQueryClient, render, screen, waitFor } from '../utils/render';

const navigate = vi.fn().mockResolvedValue(undefined);
const logout = vi.fn();

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
}));

vi.mock('../../src/api/client', () => ({
    sdk: {
        authentication: {
            sessions: { logout: (...args: unknown[]) => logout(...args) },
        },
    },
}));

function logoutButton() {
    return screen.getByRole('button', { name: 'Logout' });
}

afterEach(() => {
    navigate.mockClear();
    logout.mockReset();
    clearSession();
});

describe('RootLayout', () => {
    it('hides the nav and Logout while anonymous', () => {
        render(<RootLayout />);

        expect(screen.queryByRole('button', { name: 'Logout' })).not.toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'Home' })).not.toBeInTheDocument();
    });

    it('shows the nav and Logout for a live session', () => {
        setSession('token-123', 3600);
        render(<RootLayout />);

        expect(logoutButton()).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Playlists' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'About' })).toBeInTheDocument();
    });

    it('hides them again for a token that exists but has expired', () => {
        setSession('token-123', -1);
        render(<RootLayout />);

        expect(screen.queryByRole('button', { name: 'Logout' })).not.toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'Home' })).not.toBeInTheDocument();
    });

    it('clears the session and routes to /login on a successful logout, saying nothing failed', async () => {
        logout.mockResolvedValue(undefined);
        setSession('token-123', 3600);
        render(<RootLayout />);

        await userEvent.setup().click(logoutButton());

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

        await userEvent.setup().click(logoutButton());

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

        await userEvent.setup().click(logoutButton());

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

        await userEvent.setup().click(logoutButton());

        await waitFor(() => {
            expect(queryClient.getQueryData(['onboarding', 'requirements'])).toBeUndefined();
        });
    });

    it('lets the sign-out warning be dismissed', async () => {
        logout.mockRejectedValue(new Error('offline'));
        setSession('token-123', 3600);
        render(<RootLayout />);

        const user = userEvent.setup();
        await user.click(logoutButton());
        expect(await screen.findByText('Sign-out incomplete')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Dismiss' }));

        await waitFor(() => {
            expect(screen.queryByText('Sign-out incomplete')).not.toBeInTheDocument();
        });
    });
});
