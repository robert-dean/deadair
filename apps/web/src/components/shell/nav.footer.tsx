import { Box, NavLink, Stack } from '@mantine/core';
import type { AttentionItem } from '@deadair/sdk';

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

export interface NavFooterProps {
    /** Called after a link is followed, so the mobile drawer can shut itself. */
    onNavigate?: () => void;
    /** What needs somebody. Same list the rail above reads, so the two halves cannot disagree. */
    attention?: readonly AttentionItem[];
    /**
     * Signs the operator out. Absent draws no button at all, which is what the login page and this
     * component's own test get.
     */
    onLogout?: () => void;
    loggingOut?: boolean;
}

export function NavFooter({ onNavigate, attention = [], onLogout, loggingOut }: NavFooterProps) {
    const counts = attentionCounts(attention);

    return (
        <Box py="xs" style={{ borderTop: '1px solid var(--da-border)' }}>
            <Stack gap={2}>
                {ITEMS.map(item => (
                    <NavItem
                        key={item.label}
                        to={item.to}
                        label={item.label}
                        onNavigate={onNavigate}
                        attention={typeof item.to === 'string' ? counts.get(item.to) : undefined}
                    />
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
