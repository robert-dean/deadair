import { Box, Stack } from '@mantine/core';
import type { AttentionItem } from '@deadair/sdk';

import { Eyebrow } from '../shared/eyebrow';
import type { Severity } from '../shared/status';
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
            // Beside On air rather than under Station: both answer "what is the station playing",
            // one now and one later, and an operator who wants to change tonight arrives with the
            // same question as one changing this minute. What is under Station is who plays it.
            { to: '/schedule', label: 'Schedule' },
            { to: '/activity', label: 'Activity' },
        ],
    },
    {
        title: 'Library',
        items: [
            { to: '/catalog', label: 'Catalog' },
            { to: '/playlists', label: 'Playlists' },
            // Beside the library rather than under Air: a chart is a list of records to look at,
            // which is the question this group answers, and nothing here reaches the running order.
            { to: '/charts', label: 'Charts' },
            // Beside the charts for the same reason: this is material the station draws on rather
            // than anything it is currently doing, and both answer "what is there to talk about".
            { to: '/news', label: 'News' },
        ],
    },
    {
        // Personas beside Voices, because the two are halves of the same question: who the station
        // is, and what it sounds like saying it. A persona picks one of these voices. Scripts is
        // the third half of it and belongs here rather than under Air beside Activity: it answers
        // how a persona actually SOUNDS, which is what an operator asks while writing one, and the
        // activity feed already carries the same breaks as moments in a broadcast.
        title: 'Station',
        items: [
            { to: '/personas', label: 'Personas' },
            // Beside Personas rather than under Air with the schedule: a subject is part of what the
            // station HAS to say — the categories a bulletin can cover, the places a weather break
            // can be about — where the format clock on the schedule page is when it says it.
            { to: '/topics', label: 'Subjects' },
            // Beside Personas and Scripts, which are the other two halves of what the station says:
            // one is who it is, one is what it said, and this is what it makes at length.
            { to: '/productions', label: 'Productions' },
            { to: '/voices', label: 'Voices' },
            // Beside the voices, which is the other half of the same question: that page is who
            // the station sounds like, and this one is what it has already recorded.
            { to: '/segments', label: 'Segments' },
            // Directly under Voices, because it is the same question one level down: that page is
            // which voice says it, this is how that voice says a particular name.
            { to: '/pronunciations', label: 'Pronunciations' },
            { to: '/scripts', label: 'Scripts' },
            { to: '/plugins', label: 'Plugins' },
        ],
    },
    {
        title: 'System',
        items: [{ to: '/settings', label: 'Settings' }],
    },
];

export interface SideNavProps {
    /** Called after a link is followed, so the mobile drawer can shut itself. */
    onNavigate?: () => void;
    /**
     * What needs somebody, straight from `GET /station/attention`.
     *
     * Handed in rather than polled here, for the reason the shell already gives about layout: this
     * component is rendered bare in its own test, and a query inside it would make every test of the
     * nav a test of the network too. The shell is where the polling lives.
     */
    attention?: readonly AttentionItem[];
}

export function SideNav({ onNavigate, attention = [] }: SideNavProps) {
    const counts = countByRoute(attention);

    return (
        <Stack gap="md" py="xs">
            {GROUPS.map(group => (
                <Box key={group.title}>
                    <Box className={classes.groupLabel}>
                        <Eyebrow>{group.title}</Eyebrow>
                    </Box>
                    {group.items.map(item => (
                        <NavItem
                            key={item.label}
                            to={item.to}
                            label={item.label}
                            onNavigate={onNavigate}
                            attention={typeof item.to === 'string' ? counts.get(item.to) : undefined}
                        />
                    ))}
                </Box>
            ))}
        </Stack>
    );
}

/**
 * Which page each thing belongs to, and how bad the worst of them is.
 *
 * The route is matched on its FIRST segment, so a row pointing at one plugin's own page counts
 * against Plugins in the nav. A row whose destination is not a page in this list is simply not
 * counted anywhere — it is still on the home page, which is the surface that has to be complete.
 */
function countByRoute(items: readonly AttentionItem[]): Map<string, { count: number; severity: Severity }> {
    const worst: Record<Severity, number> = { failure: 0, warning: 1, notice: 2 };
    const counts = new Map<string, { count: number; severity: Severity }>();

    for (const item of items) {
        const page = `/${item.route.split('/')[1] ?? ''}`;
        const existing = counts.get(page);
        const severity = item.severity as Severity;

        counts.set(page, {
            count: (existing?.count ?? 0) + 1,
            severity: existing && worst[existing.severity] <= worst[severity] ? existing.severity : severity,
        });
    }

    return counts;
}
