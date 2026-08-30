import { Stack } from '@mantine/core';
import type { AttentionItem } from '@deadair/sdk';

import { attentionCounts } from './attention.destination';
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
 * are what the station plays and who plays it. What is left is the machinery, and it is not in this
 * list at all: Check-up and Settings are in `nav.footer.tsx`, pinned to the bottom of the rail,
 * because an operator who needs either has gone looking rather than arrived.
 *
 * ## The letter beside each one is the key that reaches it
 *
 * `phone.tabs.tsx` already draws these, and calls them decorative there for a good reason — a phone
 * has no keyboard to press them on. A desk does, so here they are bound: the shell registers
 * `d`, `p`, `l` and `v` against exactly this table, so the hint and the binding cannot drift.
 */
const DESTINATIONS: Pick<NavItemProps, 'to' | 'label' | 'hint'>[] = [
    // Home and On air were two links and one question. The landing page was a masthead and a list
    // of faults, and the operator's next click was always the running order — so the first page was
    // a toll gate on the second, and both drew the tally in different words.
    { to: '/', label: 'Desk', hint: 'D' },
    // Beside the desk: both answer "what is the station playing", one now and one later, and an
    // operator changing tonight arrives with the same question as one changing this minute.
    { to: '/schedule', label: 'Programme', hint: 'P' },
    // Four links became one destination with tabs. They are all answers to "what can this station
    // put on", and an operator arriving with that question had to already know whether the answer
    // was a record, a playlist, a chart or a story. Each tab is still its own route, so nothing
    // lost its URL state or its loader — see `library.shell.tsx`.
    { to: '/catalog/tracks', label: 'Library', hint: 'L' },
    // Eight links became one destination with tabs. They were eight because each is a real thing
    // with its own table — but an operator does not arrive wanting "the pronunciations page", they
    // arrive because the station said a name wrong, and every answer to THAT question is now on one
    // page.
    { to: '/voice', label: 'Voice', hint: 'V' },
];

/** The letters the shell binds, read off the table that draws them. */
export const DESTINATION_KEYS: { hint: string; to: NavItemProps['to'] }[] = DESTINATIONS.flatMap(item =>
    item.hint === undefined ? [] : [{ hint: item.hint, to: item.to }],
);

export interface SideNavProps {
    /**
     * What needs somebody, straight from `GET /station/attention`.
     *
     * Handed in rather than polled here, for the reason the shell already gives about layout: this
     * component is rendered bare in its own test, and a query inside it would make every test of the
     * nav a test of the network too. The shell is where the polling lives.
     */
    attention?: readonly AttentionItem[];
}

export function SideNav({ attention = [] }: SideNavProps) {
    const counts = attentionCounts(attention);

    return (
        <Stack gap={2} py="xs">
            {DESTINATIONS.map(item => (
                <NavItem
                    key={item.label}
                    to={item.to}
                    label={item.label}
                    hint={item.hint}
                    attention={typeof item.to === 'string' ? counts.get(item.to) : undefined}
                />
            ))}
        </Stack>
    );
}
