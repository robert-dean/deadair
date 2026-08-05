import { useState } from 'react';
import { Alert, Anchor, AppShell, Button, Group, Text } from '@mantine/core';
import { createRootRouteWithContext, Link, Outlet, redirect, useNavigate } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import type { OnboardingRequirement } from '@deadair/sdk';

import { useLogoutMutation } from '../api/auth.mutations';
import { onboardingRequirementsOptions } from '../api/onboarding.queries';
import { resolveOnboardingRedirect } from '../api/onboarding.gate';
import { resolveAuthRedirect } from '../auth/auth.gate';
import { restoreSession } from '../auth/session.bootstrap';
import { apiErrorMessage } from '../api/sdk.error';
import { isAuthenticated, isSessionActive, useSession } from '../auth/session.store';

/** Everything the router's gates need. Supplied once in `main.tsx`. */
export interface RouterContext {
    queryClient: QueryClient;
}

const REVOKE_FAILED = 'You were signed out on this device, but the server did not confirm the session was revoked.';

export function RootLayout() {
    const session = useSession();
    // The same predicate the auth gate uses: a token that exists but has expired is not a session,
    // and offering Logout for one would promise something the shell cannot deliver.
    const signedIn = isSessionActive(session);
    const navigate = useNavigate();
    const logout = useLogoutMutation();
    const [logoutError, setLogoutError] = useState<string | undefined>(undefined);

    async function handleLogout(): Promise<void> {
        let failure: string | undefined;
        try {
            await logout.mutateAsync();
        } catch (caught) {
            // A failed revoke must not strand the user in a signed-in shell, but it is not a
            // completed sign-out either: the mutation drops local state regardless, and the
            // shortfall is said out loud.
            const detail = apiErrorMessage(caught, '');
            failure = detail ? `${REVOKE_FAILED} (${detail})` : REVOKE_FAILED;
        }
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
                            <Anchor component={Link} to="/catalog" size="sm">
                                Catalog
                            </Anchor>
                            <Anchor component={Link} to="/playlists" size="sm">
                                Playlists
                            </Anchor>
                            <Anchor component={Link} to="/plugins" size="sm">
                                Plugins
                            </Anchor>
                            <Anchor component={Link} to="/about" size="sm">
                                About
                            </Anchor>
                            <Button
                                variant="subtle"
                                size="compact-sm"
                                loading={logout.isPending}
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

export const Route = createRootRouteWithContext<RouterContext>()({
    component: RootLayout,
    beforeLoad: async ({ context, location }) => {
        let requirements: OnboardingRequirement[];
        try {
            // Reads through the cache, so this and the /onboarding loader are one request.
            requirements = await context.queryClient.ensureQueryData(onboardingRequirementsOptions);
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

        await restoreSession(context.queryClient);
        const authTarget = resolveAuthRedirect(location.pathname, isAuthenticated());
        if (authTarget === '/login') {
            throw redirect({ to: '/login', search: { redirect: location.href } });
        }
        if (authTarget) {
            throw redirect({ to: authTarget });
        }
    },
});
