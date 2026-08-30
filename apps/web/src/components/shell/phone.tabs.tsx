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
const PHONE_TABS: (Pick<NavItemProps, 'to' | 'label'> & { key: string })[] = [
    { to: '/', label: 'Desk', key: 'D' },
    { to: '/schedule', label: 'Programme', key: 'P' },
    { to: '/catalog/tracks', label: 'Library', key: 'L' },
    { to: '/voice', label: 'Voice', key: 'V' },
];

/**
 * The phone's navigation: a bar across the bottom, where a thumb is.
 *
 * It replaces the burger and the drawer below `sm`. A drawer is two gestures to reach any page —
 * open it, then choose — and it covers the thing you were looking at while you decide. The bar is
 * one tap and never hides the page.
 *
 * The mono key beside each label is the same letter the design puts on the desktop rail. It is
 * decorative here rather than a shortcut, which is why it is `aria-hidden`: a phone has no keyboard
 * to press it on, and announcing "D Desk" to a screen reader would be noise.
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
                    <Text component="span" ff="monospace" size="sm" aria-hidden>
                        {tab.key}
                    </Text>
                    <Text component="span" size="xs" truncate>
                        {tab.label}
                    </Text>
                </Link>
            ))}
        </Group>
    );
}
