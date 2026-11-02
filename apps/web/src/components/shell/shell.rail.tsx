import { AppShell, ScrollArea } from '@mantine/core';
import type { ComponentProps } from 'react';

import { NavFooter } from './nav.footer';
import { SideNav } from './side.nav';

interface Props {
    attention: ComponentProps<typeof SideNav>['attention'];
    loggingOut: boolean;
    onLogout: () => void;
}

/** Split out of `__root.tsx` unchanged: the rail down the side of a signed-in page. */
export function ShellRail({ attention, loggingOut, onLogout }: Props) {
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
            {/* Both sections shrink, and this one no longer pins `flexShrink: 0`.

                It did, and the reason was measured: Settings opened out into ten sections
                with a LINE OF PROSE under each, about 500px of footer, and with both
                shrinkable the flex column took that height out of this section instead — on
                a 950px window the destinations were squeezed to 53px of scroller showing
                Desk and nothing else.

                Two things have changed and both matter. This is now the section that grows,
                because the rail draws every destination's sections: pinned, Voice's eight
                would take the whole column and leave Check-up, Settings and Logout in a
                footer scrolled to nothing with no sign they were there. And the 500px that
                caused the original squeeze is gone — a nested row carries its sentence as a
                tooltip rather than a second line, so Settings' ten are ten single rows.
                Only one destination is ever expanded, so the two sections cannot both be
                long at once, which is what makes shrinking either of them safe. */}
            <AppShell.Section grow component={ScrollArea} scrollbarSize={8} style={{ minHeight: 0 }}>
                <SideNav attention={attention} />
            </AppShell.Section>
            {/* Its own section, below the growing one, which is what pins it to the bottom
                of the rail — see `nav.footer.tsx` for why it cannot do that itself.

                `minHeight: 0` is what lets it shrink rather than overflow the rail, and the
                scroll is its own: it is the section that grows by ten rows when the operator
                is in Settings, so it is the one that has to give. */}
            <AppShell.Section component={ScrollArea} scrollbarSize={8} style={{ minHeight: 0 }}>
                <NavFooter attention={attention} loggingOut={loggingOut} onLogout={onLogout} />
            </AppShell.Section>
        </AppShell.Navbar>
    );
}
