import { Stack } from '@mantine/core';
import type { AttentionItem } from '@deadair/sdk';

import type { Severity } from '../shared/status';
import { attentionNavPageOf } from './attention.destination';
import { NavItem, type NavItemProps } from './nav.item';

/**
 * The console's destinations, in the order an operator meets them.
 *
 * ## Why this is flat again
 *
 * It was eleven links across a header, then nineteen in four groups. The groups were the right
 * answer to nineteen: flat is what had made the dead link invisible, and AIR / LIBRARY / STATION /
 * SYSTEM named the question each page answered.
 *
 * They stopped earning their keep the moment the pages behind them became tabs. A heading over one
 * item is not a grouping, and "LIBRARY › Library" is a heading arguing with its own contents. The
 * work the headings did is now done a level down, by the tab strip on each destination — which is
 * the better place for it, because a tab is visible from inside the thing it belongs to.
 *
 * ## The order is the day, not the alphabet
 *
 * The desk is where every visit starts. The schedule is the same question later. Library and Voice
 * are what the station plays and who plays it. What is left is the machinery, and it is last
 * because an operator who needs it has gone looking.
 */
const ITEMS: Pick<NavItemProps, 'to' | 'label'>[] = [
    // Home and On air were two links and one question. The landing page was a masthead and a list
    // of faults, and the operator's next click was always the running order — so the first page was
    // a toll gate on the second, and both drew the tally in different words.
    { to: '/', label: 'Desk' },
    // Beside the desk: both answer "what is the station playing", one now and one later, and an
    // operator changing tonight arrives with the same question as one changing this minute.
    { to: '/schedule', label: 'Programme' },
    // Four links became one destination with tabs. They are all answers to "what can this station
    // put on", and an operator arriving with that question had to already know whether the answer
    // was a record, a playlist, a chart or a story. Each tab is still its own route, so nothing
    // lost its URL state or its loader — see `library.shell.tsx`.
    { to: '/catalog/tracks', label: 'Library' },
    // Eight links became one destination with tabs. They were eight because each is a real thing
    // with its own table — but an operator does not arrive wanting "the pronunciations page", they
    // arrive because the station said a name wrong, and every answer to THAT question is now on one
    // page.
    { to: '/voice', label: 'Voice' },
    { to: '/plugins', label: 'Plugins' },
    // The activity feed is the second tab here now. Check-up says what the machinery is doing NOW
    // and the feed says what it DID: an operator who finds a stalled loop on the first immediately
    // wants the second, and had to go and find it in the nav.
    { to: '/checkup', label: 'Check-up' },
    { to: '/settings', label: 'Settings' },
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
        <Stack gap={2} py="xs">
            {ITEMS.map(item => (
                <NavItem
                    key={item.label}
                    to={item.to}
                    label={item.label}
                    onNavigate={onNavigate}
                    attention={typeof item.to === 'string' ? counts.get(item.to) : undefined}
                />
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
