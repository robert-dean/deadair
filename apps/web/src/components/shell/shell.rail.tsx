import { AppShell, ScrollArea } from '@mantine/core';
import { useRouterState } from '@tanstack/react-router';
import type { ComponentProps } from 'react';

import { isInsideDestination, NAV_FOOTER_DESTINATIONS } from './destinations';
import { NavFooter } from './nav.footer';
import { SideNav } from './side.nav';

interface Props {
    attention: ComponentProps<typeof SideNav>['attention'];
    loggingOut: boolean;
    onLogout: () => void;
}

/**
 * Which of the rail's two sections has a destination open in it, and so is the one that gives when
 * the column runs short.
 *
 * Only one destination is ever expanded, so only one section is ever long. The other holds a handful
 * of single rows and must keep its height: shrunk in proportion, the four destinations were cut to
 * about 115px while Settings was open, and Library slid under the footer's top edge.
 */
export function openRailSection(pathname: string): 'destinations' | 'footer' {
    return NAV_FOOTER_DESTINATIONS.some(destination => isInsideDestination(destination, pathname)) ? 'footer' : 'destinations';
}

/** Split out of `__root.tsx` unchanged: the rail down the side of a signed-in page. */
export function ShellRail({ attention, loggingOut, onLogout }: Props) {
    const open = openRailSection(useRouterState({ select: state => state.location.pathname }));
    return (
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
            {/* The section with no destination open in it keeps its height; the open one
                scrolls. See `openRailSection`.

                Pinning one section permanently failed both ways round. Pinned, this section
                took the whole column while Voice's sections were open and left Check-up,
                Settings and Logout scrolled to nothing. Unpinned, it was the one squeezed
                while Settings was open: 22 sections in 7 groups is taller than the rail at
                1440×1000, and both sections shrank in proportion until Library sat under the
                footer's top edge. The closed section is always a few single rows, so pinning
                whichever one that is never costs the open one more than it can give. */}
            <AppShell.Section grow component={ScrollArea} scrollbarSize={8} style={{ minHeight: 0, flexShrink: open === 'footer' ? 0 : 1 }}>
                <SideNav attention={attention} />
            </AppShell.Section>
            {/* Its own section, below the growing one, which is what pins it to the bottom
                of the rail — see `nav.footer.tsx` for why it cannot do that itself.

                `minHeight: 0` is what lets it shrink rather than overflow the rail when it is
                the open one, and the scroll is its own. */}
            <AppShell.Section component={ScrollArea} scrollbarSize={8} style={{ minHeight: 0, flexShrink: open === 'footer' ? 1 : 0 }}>
                <NavFooter attention={attention} loggingOut={loggingOut} onLogout={onLogout} />
            </AppShell.Section>
        </AppShell.Navbar>
    );
}
