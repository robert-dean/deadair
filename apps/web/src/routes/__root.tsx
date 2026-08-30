import { useState } from 'react';
import { ActionIcon, AppShell, Box, Button, Group, Kbd, ScrollArea, Text } from '@mantine/core';
import { useHotkeys } from '@mantine/hooks';
import { IconSearch } from '@tabler/icons-react';
import { spotlight } from '@mantine/spotlight';
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
import { usePhone } from '../components/shared/use.phone';
import { JumpTo } from '../components/shell/jump.to';
import { NavFooter } from '../components/shell/nav.footer';
import { PhoneMenu } from '../components/shell/phone.menu';
import { PhoneTabs } from '../components/shell/phone.tabs';
import { DESTINATION_KEYS, SideNav } from '../components/shell/side.nav';
import { StationMark } from '../components/shell/station.mark';
import { StationClock } from '../components/shell/station.clock';
import { StationTally } from '../components/shell/station.tally';

/** Everything the router's gates need. Supplied once in `main.tsx`. */
export interface RouterContext {
    queryClient: QueryClient;
}

const REVOKE_FAILED = 'You were signed out on this device, but the server did not confirm the session was revoked.';

/**
 * Whether the page is showing anything the operator has to dismiss before they can act on it.
 *
 * Asked of the DOM rather than of a piece of state, because the answer has to cover every modal
 * surface in the console at once — the command palette, the character editor's sheet, the slot
 * editor, the band dialog — and no component knows about the others. Mantine draws all of them
 * through `Modal`, which is `role="dialog"` on the content, so one selector is the whole question.
 */
function noDialogOpen(): boolean {
    return document.querySelector('[role="dialog"]') === null;
}

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
    // The phone gets a bar across the bottom rather than a drawer behind a burger. A drawer is two
    // gestures to reach any page — open it, then choose — and it covers the thing you were looking
    // at while you decide.
    //
    // A hook rather than CSS alone because `AppShell` reserves the footer's height in layout
    // whether or not its contents render, so the shell has to KNOW rather than just hide it. The
    // hook's first-paint fallback is the desktop, and `use.phone.ts` says why.
    const phone = usePhone();

    // The letters drawn in the rail's gutter, bound to the destinations that draw them. Read off
    // `DESTINATION_KEYS` rather than restated here, so a hint the nav shows and a key the shell
    // listens for cannot come apart.
    //
    // Two guards, and neither is optional for a single-letter binding. `useHotkeys` already ignores
    // events originating in an INPUT, TEXTAREA or SELECT, so the catalog's search box takes a `d`
    // and keeps it — but a sheet or a dialog is full of controls that are none of those, and a `v`
    // pressed with focus on the character editor's Save button would navigate away from unsaved
    // edits. `noDialogOpen` is what stops that. `signedIn` is the second: the login page has no
    // shortcuts to a shell that is not drawn.
    useHotkeys(
        signedIn
            ? DESTINATION_KEYS.map(key => [
                  key.hint.toLowerCase(),
                  () => {
                      if (!noDialogOpen()) return;
                      void navigate({ to: key.to });
                  },
              ])
            : [],
    );

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
            navbar={signedIn ? { width: 204, breakpoint: 'sm', collapsed: { mobile: true } } : undefined}
            footer={signedIn && phone ? { height: 64 } : undefined}
            padding="md"
        >
            <AppShell.Header className="da-scanlines">
                <Group h="100%" px="md" gap="md" wrap="nowrap">
                    <Group gap="sm" wrap="nowrap" style={{ flexShrink: 0 }}>
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
                    {/* The way to anywhere, and the clock. Logout was in this corner and is in the
                        rail's footer now: the header's right edge is where an operator looks for
                        the state of the station and the way to move around it, and a control for
                        ending your session is neither. */}
                    {signedIn ? (
                        <Group gap="sm" wrap="nowrap" style={{ flexShrink: 0 }}>
                            <Button
                                variant="default"
                                size="compact-sm"
                                fw={400}
                                c="dimmed"
                                onClick={spotlight.open}
                                rightSection={<Kbd size="xs">⌘K</Kbd>}
                                visibleFrom="sm"
                            >
                                Jump to anything
                            </Button>
                            {/* The same door with no keycap on it: a phone has no ⌘K, and a button
                                reading "Jump to anything" is wider than the header can spare. */}
                            <ActionIcon variant="default" size="lg" aria-label="Jump to anything" onClick={spotlight.open} hiddenFrom="sm">
                                <IconSearch size={18} stroke={1.8} />
                            </ActionIcon>
                            {/* Not on a phone: the phone's own status bar is already a clock an
                                inch away, and the 70px this frees is what keeps the corner's two
                                controls on the right side of the bezel. */}
                            <Box visibleFrom="sm">
                                <StationClock />
                            </Box>
                            {/* The rail's footer, for a viewport that has no rail — see the
                                component for why this is not the drawer coming back. */}
                            <PhoneMenu
                                loggingOut={logout.isPending}
                                onLogout={() => {
                                    void handleLogout();
                                }}
                            />
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
                        <SideNav attention={attention.data?.items} />
                    </AppShell.Section>
                    {/* Its own section, below the growing one, which is what pins it to the bottom
                        of the rail — see `nav.footer.tsx` for why it cannot do that itself. */}
                    <AppShell.Section>
                        <NavFooter
                            attention={attention.data?.items}
                            loggingOut={logout.isPending}
                            onLogout={() => {
                                void handleLogout();
                            }}
                        />
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
            {signedIn && phone ? (
                <AppShell.Footer withBorder={false}>
                    <PhoneTabs />
                </AppShell.Footer>
            ) : undefined}
            {/* Rendered rather than opened: the component registers `mod + K` itself, and one copy
                inside the shell is what makes the shortcut work from every page. Guarded on the
                session because every place it can go is behind one. */}
            {signedIn ? <JumpTo /> : undefined}
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
