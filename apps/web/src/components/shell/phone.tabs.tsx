import { Group, Text } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import type { NavItemProps } from './nav.item';

/**
 * The four destinations a phone gets, and nothing else.
 *
 * Not the whole nav. A bottom bar has room for four targets at a thumb-sized width, and the console
 * has six links — so the two that are NOT here are the two an operator does not reach for from bed:
 * Check-up is what you open when something is wrong and you are sitting down, and Settings is not a
 * thing anybody configures on a phone. Both are still reachable, from the rows that link to them.
 */
const PHONE_TABS: Pick<NavItemProps, 'to' | 'label'>[] = [
    { to: '/', label: 'Desk' },
    { to: '/schedule', label: 'Programme' },
    { to: '/catalog/tracks', label: 'Library' },
    { to: '/voice', label: 'Voice' },
];

/**
 * The phone's navigation: a bar across the bottom, where a thumb is.
 *
 * It replaces the burger and the drawer below `sm`. A drawer is two gestures to reach any page —
 * open it, then choose — and it covers the thing you were looking at while you decide. The bar is
 * one tap and never hides the page.
 *
 * No mono key here, and deliberately not: `side.nav.tsx` draws the same letter beside each
 * destination because `SideNav` is where the shell binds it as a real keyboard shortcut. A phone
 * has no keyboard, so the letter would be a character that means nothing, costing a line of height
 * on the one viewport with the least of it to spare. No icon either — the desktop rail has none,
 * and two navs disagreeing about whether a destination has an icon is worse than neither having one.
 */
export function PhoneTabs() {
    return (
        <Group
            component="nav"
            aria-label="Destinations"
            gap={0}
            h="100%"
            wrap="nowrap"
            style={{ borderTop: '1px solid var(--da-border)', background: 'var(--da-panel)' }}
        >
            {PHONE_TABS.map(tab => (
                <Link
                    key={tab.label}
                    to={tab.to}
                    // 64px tall and a quarter of the width: comfortably past the 44px the
                    // design asks for, in both directions, because this is the control an
                    // operator uses one-handed and half-asleep.
                    style={{
                        flex: 1,
                        minWidth: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 2,
                        textDecoration: 'none',
                        color: 'var(--da-text-secondary)',
                        borderTop: '2px solid transparent',
                    }}
                    activeProps={{
                        style: { color: 'var(--da-text)', borderTop: '2px solid var(--da-phosphor)' },
                    }}
                    activeOptions={{ exact: tab.to === '/' }}
                >
                    <Text component="span" size="xs" truncate>
                        {tab.label}
                    </Text>
                </Link>
            ))}
        </Group>
    );
}
