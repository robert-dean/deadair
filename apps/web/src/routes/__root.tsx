import { useState } from 'react';
import { Alert, Anchor, AppShell, Button, Group, Text } from '@mantine/core';
import { createRootRoute, Link, Outlet, redirect, useNavigate } from '@tanstack/react-router';
import type { OnboardingRequirement } from '@deadair/sdk';

import { sdk } from '../api/client';
import { loadOnboardingRequirements } from '../api/onboarding';
import { resolveOnboardingRedirect } from '../api/onboarding.gate';
import { resolveAuthRedirect } from '../auth/auth.gate';
import { resetSessionBootstrap, restoreSession } from '../auth/session.bootstrap';
import { apiErrorMessage } from '../api/sdk.error';
import { clearSession, isAuthenticated, isSessionActive, useSession } from '../auth/session.store';

const REVOKE_FAILED = 'You were signed out on this device, but the server did not confirm the session was revoked.';

export function RootLayout() {
    const session = useSession();
    // The same predicate the auth gate uses: a token that exists but has expired is not a session,
    // and offering Logout for one would promise something the shell cannot deliver.
    const signedIn = isSessionActive(session);
    const navigate = useNavigate();
    const [logoutError, setLogoutError] = useState<string | undefined>(undefined);

    async function handleLogout(): Promise<void> {
        let failure: string | undefined;
        try {
            await sdk.authentication.sessions.logout();
        } catch (caught) {
            // A failed revoke must not strand the user in a signed-in shell, but it is not a
            // completed sign-out either: local state goes, and the shortfall is said out loud.
            const detail = apiErrorMessage(caught, '');
            failure = detail ? `${REVOKE_FAILED} (${detail})` : REVOKE_FAILED;
        }
        clearSession();
        resetSessionBootstrap();
        setLogoutError(failure);
        await navigate({ to: '/login' });
    }

    return (
        <AppShell header={{ height: 56 }} padding="lg">
            <AppShell.Header>
                <Group h="100%" px="lg" justify="space-between">
                    <Text fw={700} tt="uppercase" style={{ letterSpacing: '0.12em' }}>
                        deadair
                    </Text>
                    {signedIn ? (
                        <Group gap="lg">
                            <Anchor component={Link} to="/" size="sm">
                                Home
                            </Anchor>
                            <Anchor component={Link} to="/about" size="sm">
                                About
                            </Anchor>
                            <Button
                                variant="subtle"
                                size="compact-sm"
                                onClick={() => {
                                    void handleLogout();
                                }}
                            >
                                Logout
                            </Button>
                        </Group>
                    ) : undefined}
                </Group>
            </AppShell.Header>
            <AppShell.Main>
                {logoutError ? (
                    <Alert
                        color="yellow"
                        title="Sign-out incomplete"
                        mb="lg"
                        withCloseButton
                        closeButtonLabel="Dismiss"
                        onClose={() => {
                            setLogoutError(undefined);
                        }}
                    >
                        {logoutError}
                    </Alert>
                ) : undefined}
                <Outlet />
            </AppShell.Main>
        </AppShell>
    );
}

export const Route = createRootRoute({
    component: RootLayout,
    beforeLoad: async ({ location }) => {
        let requirements: OnboardingRequirement[];
        try {
            requirements = await loadOnboardingRequirements();
        } catch {
            // The API is unreachable. Render the app rather than trapping the user in a redirect
            // loop against a service that cannot answer either gate.
            return;
        }

        // Redirects are thrown, so they stay outside the try above.
        const onboardingTarget = resolveOnboardingRedirect(location.pathname, requirements);
        if (onboardingTarget) {
            throw redirect({ to: onboardingTarget });
        }

        await restoreSession();
        const authTarget = resolveAuthRedirect(location.pathname, isAuthenticated());
        if (authTarget === '/login') {
            throw redirect({ to: '/login', search: { redirect: location.href } });
        }
        if (authTarget) {
            throw redirect({ to: authTarget });
        }
    },
});
