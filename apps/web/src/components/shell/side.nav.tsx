import { Box, Stack } from '@mantine/core';

import { Eyebrow } from '../shared/eyebrow';
import { NavItem, type NavItemProps } from './nav.item';
import classes from './side.nav.module.css';

interface NavGroup {
    title: string;
    items: Pick<NavItemProps, 'to' | 'label'>[];
}

/**
 * The console's pages, grouped by the question an operator arrives with.
 *
 * Eleven flat links across a 56px header had outgrown the row, and flat is also what made the
 * dead one invisible. The grouping is not alphabetisation: AIR is what is happening now, LIBRARY
 * is what there is to play, STATION is who plays it and how, SYSTEM is the machinery. Activity
 * sits under AIR rather than with the machinery because it answers the question On air raises
 * when the station is not doing what was expected.
 */
const GROUPS: NavGroup[] = [
    {
        title: 'Air',
        items: [
            { to: '/', label: 'Home' },
            { to: '/onair', label: 'On air' },
            { to: '/activity', label: 'Activity' },
        ],
    },
    {
        title: 'Library',
        items: [
            { to: '/catalog', label: 'Catalog' },
            { to: '/playlists', label: 'Playlists' },
        ],
    },
    {
        // Personas beside Voices, because the two are halves of the same question: who the station
        // is, and what it sounds like saying it. A persona picks one of these voices.
        title: 'Station',
        items: [
            { to: '/personas', label: 'Personas' },
            { to: '/voices', label: 'Voices' },
            { to: '/plugins', label: 'Plugins' },
        ],
    },
    {
        title: 'System',
        items: [
            { to: '/settings', label: 'Settings' },
            { to: '/about', label: 'About' },
        ],
    },
];

export interface SideNavProps {
    /** Called after a link is followed, so the mobile drawer can shut itself. */
    onNavigate?: () => void;
}

export function SideNav({ onNavigate }: SideNavProps) {
    return (
        <Stack gap="md" py="xs">
            {GROUPS.map(group => (
                <Box key={group.title}>
                    <Box className={classes.groupLabel}>
                        <Eyebrow>{group.title}</Eyebrow>
                    </Box>
                    {group.items.map(item => (
                        <NavItem key={item.label} to={item.to} label={item.label} onNavigate={onNavigate} />
                    ))}
                </Box>
            ))}
        </Stack>
    );
}
