import { Group, Text } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { NavLink } from './destinations';

/**
 * The four destinations a phone gets, and nothing else.
 *
 * Not the whole nav. A bottom bar has room for four targets at a thumb-sized width, and the console
 * has six links — so the two that are NOT here are the two an operator does not reach for from bed:
 * Check-up is what you open when something is wrong and you are sitting down, and Settings is not a
 * thing anybody configures on a phone. Both are still reachable, from the rows that link to them.
 */
const PHONE_TABS: (Pick<NavLink, 'to'> & { labelKey: 'desk' | 'programme' | 'library' | 'voice' })[] = [
    { to: '/', labelKey: 'desk' },
    { to: '/schedule', labelKey: 'programme' },
    { to: '/catalog/tracks', labelKey: 'library' },
    { to: '/voice', labelKey: 'voice' },
];

/**
 * The phone's navigation: a bar across the bottom, where a thumb is.
 *
 * It replaces the burger and the drawer below `sm`. A drawer is two gestures to reach any page —
 * open it, then choose — and it covers the thing you were looking at while you decide. The bar is
 * one tap and never hides the page.
 *
 * No key letter here, and deliberately not: the header's tabs name the letter the shell binds as a
 * keyboard shortcut, and a phone has no keyboard, so it would be a character that means nothing. No
 * icon either: the header's tabs have none, and two navs disagreeing about whether a destination has
 * an icon is worse than neither having one.
 */
export function PhoneTabs() {
    const { t } = useTranslation('shell');
    return (
        <Group
            component="nav"
            aria-label={t('phoneTabs.label')}
            gap={0}
            h="100%"
            wrap="nowrap"
            style={{ borderTop: '1px solid var(--da-border)', background: 'var(--da-panel)' }}
        >
            {PHONE_TABS.map(tab => (
                <Link
                    key={tab.labelKey}
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
                        {t(`destination.${tab.labelKey}`)}
                    </Text>
                </Link>
            ))}
        </Group>
    );
}
