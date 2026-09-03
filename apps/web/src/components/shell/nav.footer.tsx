import { Fragment, useEffect, useRef } from 'react';
import { Box, NavLink, Stack } from '@mantine/core';
import { useRouterState } from '@tanstack/react-router';
import type { AttentionItem } from '@deadair/sdk';

import { attentionCounts } from './attention.destination';
import { isInsideDestination, NAV_FOOTER_DESTINATIONS } from './destinations';
import { NavItem } from './nav.item';
import classes from './side.nav.module.css';

/**
 * The machinery, and the way out.
 *
 * Two links and a button, under a rule at the bottom of the rail. They were ordinary entries in the
 * destination list and Logout was a button in the header, which put three unrelated things in three
 * places: the header's right edge held a control that has nothing to do with what is going out, and
 * Check-up sat in the same list as Library as though an operator picks between them.
 *
 * They are not destinations in the sense the four above are. Nobody opens the console to look at
 * Settings; they arrive at it from something that sent them, which is why these carry no key hint —
 * a shortcut is for a place you go on purpose.
 *
 * ## Why this is a component and not the bottom of `SideNav`
 *
 * It has to be pinned, and pinning it inside `SideNav` cannot work: the rail scrolls, and the shell
 * hands `SideNav` to an `AppShell.Section grow component={ScrollArea}` whose content height is its
 * content. `margin-top: auto` in there pushes against nothing. The shell renders this in a second,
 * non-growing `AppShell.Section` instead, which is the same reason the scroll lives in the shell
 * rather than here: layout that depends on the shell belongs to the shell.
 */

/**
 * Where the operator is, which is the only thing this asks the router.
 *
 * Read off the router rather than computed from a prop, so it cannot give a different answer than
 * the `data-status` the links themselves carry.
 */
const usePathname = (): string => useRouterState({ select: state => state.location.pathname });

export interface NavFooterProps {
    /** What needs somebody. Same list the rail above reads, so the two halves cannot disagree. */
    attention?: readonly AttentionItem[];
    /**
     * Signs the operator out. Absent draws no button at all, which is what the login page and this
     * component's own test get.
     */
    onLogout?: () => void;
    loggingOut?: boolean;
}

export function NavFooter({ attention = [], onLogout, loggingOut }: NavFooterProps) {
    const counts = attentionCounts(attention);
    const pathname = usePathname();
    const rows = useRef<HTMLDivElement>(null);

    // The sections are taller than the space the rail can give them — ten rows and a line of prose
    // each — so the shell lets this section scroll. Landing on `/plugins`, which is last, would
    // otherwise open a list scrolled to the top with the row you are actually on below the fold and
    // nothing saying so.
    //
    // `block: 'nearest'` scrolls only when the row is not already visible, so arriving at Station,
    // which is first, moves nothing. Optional-called because jsdom does not implement it.
    useEffect(() => {
        rows.current?.querySelector('[data-status="active"]')?.scrollIntoView?.({ block: 'nearest' });
    }, [pathname]);

    return (
        <Box ref={rows} py="xs" style={{ borderTop: '1px solid var(--da-border)' }}>
            <Stack gap={2}>
                {NAV_FOOTER_DESTINATIONS.map(destination => (
                    <Fragment key={destination.label}>
                        <NavItem
                            to={destination.to}
                            label={destination.label}
                            attention={typeof destination.to === 'string' ? counts.get(destination.to) : undefined}
                            // Both of these have children, so both prefix-match their own sections.
                            // Without this the parent lights up beside whichever child is open and
                            // the rail says the operator is in two places.
                            exact
                        />

                        {/* Drawn only while the operator is inside it, the same rule the rail above
                            follows. Check-up's four are here for the first time: they were a tab
                            strip, and the console navigates one way now. */}
                        {isInsideDestination(destination, pathname)
                            ? destination.sections.map(section => (
                                  <NavItem
                                      key={section.label}
                                      to={section.to}
                                      search={section.search}
                                      label={section.label}
                                      hintText={section.hintText}
                                      nested
                                      attention={typeof section.to === 'string' ? counts.get(section.to) : undefined}
                                  />
                              ))
                            : undefined}
                    </Fragment>
                ))}

                {/* Drawn as one of the rail's own rows rather than as a button placed near them.
                    A `Button` beside two `NavLink`s needs a hand-set left margin to line its label
                    up with theirs, and a magic number is a thing that goes stale the first time the
                    nav's padding changes. `component="button"` keeps the geometry by construction;
                    the polymorphic-prop rule this file otherwise follows is about `component={Link}`
                    erasing the ROUTER's typing, and there is no route here to lose. */}
                {onLogout ? (
                    <NavLink
                        component="button"
                        type="button"
                        classNames={{ root: classes.item, label: classes.label }}
                        label="Logout"
                        disabled={loggingOut}
                        onClick={onLogout}
                    />
                ) : undefined}
            </Stack>
        </Box>
    );
}
