import { useEffect, useRef } from 'react';
import { Anchor, AppShell, Box, Center, Loader } from '@mantine/core';
import { useHotkeys } from '@mantine/hooks';
import { createRootRouteWithContext, Outlet, redirect, useNavigate, useRouter, useRouterState } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { OnboardingRequirement } from '@deadair/sdk';

import { onboardingRequirementsOptions } from '../api/onboarding.queries';
import { resolveOnboardingRedirect } from '../api/onboarding.gate';
import { resolveAuthRedirect } from '../auth/auth.gate';
import { restoreSession } from '../auth/session.bootstrap';
import { AccountView } from '../components/account/account.view';
import { isAuthenticated, isSessionActive, useSession } from '../auth/session.store';
import { usePlayoutStatus } from '../api/playout.queries';
import { useStationAttention } from '../api/station.queries';
import { ApiStatusBanner } from '../components/shared/api.status.banner';
import { ErrorAlert } from '../components/shared/error.alert';
import { usePhone } from '../components/shared/use.phone';
import { JumpTo } from '../components/shell/jump.to';
import { PhoneTabs } from '../components/shell/phone.tabs';
import { DESTINATION_KEYS } from '../components/shell/destinations';
import { ShellHeader } from '../components/shell/shell.header';
import { ShellRail } from '../components/shell/shell.rail';
import { useLogoutFlow } from '../components/shell/use.logout.flow';
import { useShellAccount } from '../components/shell/use.shell.account';
import { useAccountLanguage } from '../api/languages.queries';

/** Everything the router's gates need. Supplied once in `main.tsx`. */
export interface RouterContext {
    queryClient: QueryClient;
}

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

/**
 * Asks the router's gate again the moment a session dies, rather than on the next navigation.
 *
 * The gate runs in `beforeLoad`, so a page whose session ended under it stayed drawn, and anything it
 * polled was refused every few seconds until somebody clicked: a desk left open answered 401 for 43
 * minutes. Invalidating re-runs `beforeLoad`, which tries the refresh cookie first, so a session the
 * cookie can still buy stays on the page and one it cannot is sent to sign-in with the way back.
 */
function useLeaveWhenSignedOut(signedIn: boolean): void {
    const router = useRouter();
    const wasSignedIn = useRef(signedIn);

    useEffect(() => {
        if (wasSignedIn.current && !signedIn) void router.invalidate();
        wasSignedIn.current = signedIn;
    }, [router, signedIn]);
}

/** Signed-in pages drawn without the console's shell. */
const BARE_PATHS: readonly string[] = ['/party-poster'];

/**
 * Signed-in pages any account may use whatever its role: approving an app that wants to act as you,
 * and the landing a sign-in comes back to. Everything else is the station's controls, which only an
 * admin is shown.
 */
const ANY_ACCOUNT_PATHS: readonly string[] = ['/oauth/', '/auth/'];

export function RootLayout() {
    const { t } = useTranslation('routes');
    const session = useSession();
    // The same predicate the auth gate uses: a token that exists but has expired is not a session,
    // and offering Logout for one would promise something the shell cannot deliver.
    const signedIn = isSessionActive(session);
    useLeaveWhenSignedOut(signedIn);
    // The console in the language this account chose, once there is an account to ask.
    useAccountLanguage(signedIn);
    const navigate = useNavigate();
    const { logout, logoutError, setLogoutError, handleLogout } = useLogoutFlow();
    const { account, isAdmin, noRole, roleKnown, desk } = useShellAccount(signedIn);
    // Polled here rather than on each page: the header's tally draws from it on every screen, and
    // the desk reads the same key from the same cache rather than issuing its own request.
    const playout = usePlayoutStatus(desk);
    // The nav's badges, from the same answer the desk draws as a list — one query, one cache, so a
    // badge saying two and a list showing three is not a state this console can reach.
    const attention = useStationAttention(desk);
    // The phone gets a bar across the bottom rather than a drawer behind a burger. A drawer is two
    // gestures to reach any page — open it, then choose — and it covers the thing you were looking
    // at while you decide.
    //
    // A hook rather than CSS alone because `AppShell` reserves the footer's height in layout
    // whether or not its contents render, so the shell has to KNOW rather than just hide it. The
    // hook's first-paint fallback is the desktop, and `use.phone.ts` says why.
    const phone = usePhone();
    const pathname = useRouterState({ select: state => state.location.pathname });

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

    // A page that is the whole screen, drawn without the shell: the party's poster, on a TV across
    // the room, where a header and a rail would only be things for a guest to read instead of the code.
    if (BARE_PATHS.includes(pathname)) return <Outlet />;

    if (signedIn && !ANY_ACCOUNT_PATHS.some(prefix => pathname.startsWith(prefix))) {
        // Nothing until the roles are known, so a listener never sees the desk flash past.
        if (!roleKnown) {
            return (
                <Center mih="60vh">
                    <Loader aria-label={t('root.checkingAccount')} />
                </Center>
            );
        }
        if (noRole || (account.data !== undefined && !isAdmin)) {
            return (
                <AccountView
                    loggingOut={logout.isPending}
                    onLogout={() => {
                        void handleLogout();
                    }}
                />
            );
        }
    }

    return (
        <AppShell
            header={{ height: 52 }}
            navbar={signedIn ? { width: 204, breakpoint: 'sm', collapsed: { mobile: true } } : undefined}
            footer={signedIn && phone ? { height: 64 } : undefined}
            padding="md"
        >
            {/* First focusable element in the document, so it is the first Tab stop on every page.
                Everything else in the shell comes before the content it names: the wordmark, the
                tally, the jump button, four destinations, two pinned links — eight stops before an
                operator who cannot see the rail reaches the running order it exists to get them to.
                Visible only on focus, through `.da-skip` in `tokens.css`; `href="#main"` is a
                fragment rather than a route, so this is a plain `Anchor` and not a `renderRoot`
                `Link` — there is no route here for the router's typing to protect. */}
            <Anchor href="#main" className="da-skip">
                {t('root.skipToContent')}
            </Anchor>

            <ShellHeader
                signedIn={signedIn}
                status={playout.data}
                loggingOut={logout.isPending}
                onLogout={() => {
                    void handleLogout();
                }}
            />
            {signedIn ? (
                <ShellRail
                    attention={attention.data?.items}
                    loggingOut={logout.isPending}
                    onLogout={() => {
                        void handleLogout();
                    }}
                />
            ) : undefined}
            <AppShell.Main id="main" tabIndex={-1}>
                {/* Above everything, including the page's own failures, and drawn whether or not
                    anybody is signed in: an unreachable API is why the login page will not submit
                    either, and that is worth saying rather than leaving as a spinner. It carries
                    its own spacing and renders nothing at all while the station answers, so there
                    is no wrapper here holding a gap open for a banner that is not there. */}
                <ApiStatusBanner />
                {logoutError ? (
                    <Box mb="lg">
                        <ErrorAlert
                            tone="warning"
                            title={t('root.signOutIncompleteTitle')}
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
