import { Fragment, useEffect, useRef } from 'react';
import { Box, NavLink, Stack } from '@mantine/core';
import { useRouterState } from '@tanstack/react-router';
import type { AttentionItem } from '@deadair/sdk';

import { SETTINGS_ROUTES, SETTINGS_SECTIONS } from '../settings/settings.shell';
import { attentionCounts } from './attention.destination';
import { NavItem, type NavItemProps } from './nav.item';
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

const ITEMS: Pick<NavItemProps, 'to' | 'label'>[] = [
    // The activity feed is the second tab here now. Check-up says what the machinery is doing NOW
    // and the feed says what it DID: an operator who finds a stalled loop on the first immediately
    // wants the second, and had to go and find it in the nav.
    { to: '/checkup', label: 'Check-up' },
    // Plugins is a section of Settings now: a plugin is a thing you configure, and its own
    // configuration was already the other half of that page.
    { to: '/settings', label: 'Settings' },
];

/**
 * Where the operator is, which is the only thing this asks the router.
 *
 * Read off the router rather than computed from a prop, so it cannot give a different answer than
 * the `data-status` the links themselves carry.
 */
const usePathname = (): string => useRouterState({ select: state => state.location.pathname });

/**
 * Whether that path is inside Settings, which is what decides if the sections are drawn.
 *
 * `/plugins` counts. It is a section of Settings that happens to have been a route first, and an
 * operator on it is inside Settings by every measure except the shape of the URL.
 */
const inSettingsAt = (path: string): boolean =>
    path === '/settings' || path.startsWith('/settings/') || path === '/plugins' || path.startsWith('/plugins/');

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
    const inSettings = inSettingsAt(pathname);
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
                {ITEMS.map(item => (
                    <Fragment key={item.label}>
                        <NavItem
                            to={item.to}
                            label={item.label}
                            attention={typeof item.to === 'string' ? counts.get(item.to) : undefined}
                            // Settings prefix-matches every one of its own sections, so without this
                            // the parent lights up beside whichever child is open and the rail says
                            // the operator is in two places. Only needed on an entry that has
                            // children, which is why it is not on `NavItem` for everybody.
                            {...(item.to === '/settings' ? { exact: true } : {})}
                        />

                        {/* Ten rows and their hints, where a strip of ten tabs had room for neither.
                            Drawn only while the operator is in Settings: the rail is otherwise four
                            destinations and two links, and ten permanent extra rows would be a lot
                            of standing furniture for somewhere nobody opens the console to look at.

                            This is the one nested thing in the nav, and `side.nav.tsx` argues at
                            length for the nav being flat. The argument there is that a destination's
                            own tab strip does this job better because it is visible from inside the
                            thing it belongs to — true while a strip fits, which is Library's five
                            and Check-up's four, and not Settings' ten. */}
                        {item.to === '/settings' && inSettings
                            ? SETTINGS_SECTIONS.map(section => (
                                  <NavItem
                                      key={section.id}
                                      to={SETTINGS_ROUTES[section.id]}
                                      label={section.label}
                                      hintText={section.hint}
                                      nested
                                      attention={counts.get(SETTINGS_ROUTES[section.id])}
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
