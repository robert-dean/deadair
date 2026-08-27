import { Box, Stack } from '@mantine/core';
import type { AttentionItem } from '@deadair/sdk';

import { Eyebrow } from '../shared/eyebrow';
import type { Severity } from '../shared/status';
import { attentionNavPageOf } from './attention.destination';
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
            // Home and On air were two links and one question. The landing page was a masthead and
            // a list of faults, and the operator's next click was always the running order — so the
            // first page was a toll gate on the second, and both drew the tally in different words.
            { to: '/', label: 'Desk' },
            // Beside the desk rather than under Station: both answer "what is the station playing",
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
        // Eight links became one destination with tabs. They were eight because each is a real
        // thing with its own table — but an operator does not arrive wanting "the pronunciations
        // page", they arrive because the station said a name wrong, and every answer to THAT
        // question now sits on one page. Subjects is in there too: it is not speech, but it is what
        // the station has to talk about, which is the same question one step back.
        title: 'Station',
        items: [
            { to: '/voice', label: 'Voice' },
            { to: '/plugins', label: 'Plugins' },
        ],
    },
    {
        title: 'System',
        items: [
            // Under System rather than Air: this is a page about the machinery, beside the plugins
            // and the settings, where the home page's list is the one about the broadcast.
            { to: '/checkup', label: 'Check-up' },
            { to: '/settings', label: 'Settings' },
        ],
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
        // Read from the same table the rows link with, so a badge on one nav entry and a row
        // pointing at another is not a state this console can reach. A route it does not recognise
        // is counted nowhere — it is still on the desk, which is the surface that has to be
        // complete.
        const page = attentionNavPageOf(item.route);
        if (page === undefined) continue;
        const existing = counts.get(page);
        const severity = item.severity as Severity;

        counts.set(page, {
            count: (existing?.count ?? 0) + 1,
            severity: existing && worst[existing.severity] <= worst[severity] ? existing.severity : severity,
        });
    }

    return counts;
}
