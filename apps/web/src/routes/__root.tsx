import { useState } from 'react';
import { AppShell, Box, Burger, Button, Group, ScrollArea, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { createRootRouteWithContext, Outlet, redirect, useNavigate } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import type { OnboardingRequirement } from '@deadair/sdk';

import { useLogoutMutation } from '../api/auth.mutations';
import { onboardingRequirementsOptions } from '../api/onboarding.queries';
import { resolveOnboardingRedirect } from '../api/onboarding.gate';
import { resolveAuthRedirect } from '../auth/auth.gate';
import { restoreSession } from '../auth/session.bootstrap';
import { apiErrorMessage } from '../api/sdk.error';
import { isAuthenticated, isSessionActive, useSession } from '../auth/session.store';
import { usePlayoutStatus } from '../api/playout.queries';
import { useStationAttention } from '../api/station.queries';
import { ErrorAlert } from '../components/shared/error.alert';
import { SideNav } from '../components/shell/side.nav';
import { StationMark } from '../components/shell/station.mark';
import { StationClock } from '../components/shell/station.clock';
import { StationTally } from '../components/shell/station.tally';

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
    // Polled here rather than on each page: the header's tally draws from it on every screen, and
    // the desk reads the same key from the same cache rather than issuing its own request.
    const playout = usePlayoutStatus(signedIn);
    // The nav's badges, from the same answer the desk draws as a list — one query, one cache, so a
    // badge saying two and a list showing three is not a state this console can reach.
    const attention = useStationAttention(signedIn);
    // Phone only: on a desk the nav is always there, and this stays false for its whole life.
    const [navOpened, navDrawer] = useDisclosure(false);

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
        <AppShell
            header={{ height: 52 }}
            navbar={signedIn ? { width: 204, breakpoint: 'sm', collapsed: { mobile: !navOpened } } : undefined}
            padding="md"
        >
            <AppShell.Header className="da-scanlines">
                <Group h="100%" px="md" gap="md" wrap="nowrap">
                    <Group gap="sm" wrap="nowrap" style={{ flexShrink: 0 }}>
                        {signedIn ? (
                            <Burger opened={navOpened} onClick={navDrawer.toggle} hiddenFrom="sm" size="sm" aria-label="Navigation" />
                        ) : undefined}
                        <StationMark />
                        <Text ff="heading" fw={700} tt="uppercase" style={{ letterSpacing: 'var(--da-tracking-wordmark)' }}>
                            deadair
                        </Text>
                    </Group>
                    {/* Beside the wordmark rather than out at the right edge: this is what the
                        station IS at this moment, so it reads as part of the identity rather than
                        as one more control. The clock stays right, where a clock belongs. */}
                    {signedIn ? <StationTally status={playout.data} /> : undefined}
                    <Box style={{ flex: 1, minWidth: 0 }} />
                    {signedIn ? (
                        <Group gap="sm" wrap="nowrap" style={{ flexShrink: 0 }}>
                            <StationClock />
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
            {signedIn ? (
                <AppShell.Navbar>
                    {/* The nav SCROLLS inside whatever height the shell leaves it, rather than
                        being tall enough for its links.

                        The shell sizes the navbar as the viewport minus the header and minus the
                        footer, and the footer is the transport — which is 280px expanded against
                        96 shut. On a 647px window that leaves the nav 311px for twelve links and
                        four headings, about 520px of content, and nothing was clipping it: the
                        links painted straight over the player. The boxes always tiled correctly,
                        so this was never a positioning bug, only content with nowhere to go.

                        Here rather than in `SideNav` because `AppShell.Section` reads the shell's
                        context and throws without it, and the nav is rendered bare in its own
                        test. Layout that depends on the shell belongs to the shell. */}
                    <AppShell.Section grow component={ScrollArea} scrollbarSize={8} style={{ minHeight: 0 }}>
                        <SideNav onNavigate={navDrawer.close} attention={attention.data?.items} />
                    </AppShell.Section>
                </AppShell.Navbar>
            ) : undefined}
            <AppShell.Main>
                {logoutError ? (
                    <Box mb="lg">
                        <ErrorAlert
                            tone="warning"
                            title="Sign-out incomplete"
                            onDismiss={() => {
                                setLogoutError(undefined);
                            }}
                        >
                            {logoutError}
                        </ErrorAlert>
                    </Box>
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
