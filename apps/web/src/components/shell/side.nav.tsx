import { Fragment } from 'react';
import { Stack } from '@mantine/core';
import { useRouterState } from '@tanstack/react-router';
import type { AttentionItem } from '@deadair/sdk';

import { attentionCounts } from './attention.destination';
import { isInsideDestination, NAV_DESTINATIONS } from './destinations';
import { NavItem } from './nav.item';

/**
 * The console's destinations, in the order an operator meets them.
 *
 * ## Why the sections are here and not in a strip
 *
 * It was eleven links across a header, then nineteen in four groups, then four destinations with a
 * tab strip each. The strip was the right answer for as long as it fitted, and it was the better
 * place for the work the old headings did, because a tab is visible from inside the thing it
 * belongs to.
 *
 * A tab is only "visible from inside the thing it belongs to" while it is visible. Settings' ten
 * sections were never going to fit and have been rows in `nav.footer.tsx` for as long as there have
 * been ten, and then Voice grew to eight: 1122px of tabs inside a 964px strip at a 1200px window,
 * with Productions and What it said off the end of it and no scrollbar to say so, because the strip
 * hides its own. Picking one from the middle scrolled the first two off the other end instead.
 *
 * So the exception became the rule. Every destination's sections are rows here, and the strip is
 * what the PHONE draws — where it is a swipe rather than a hidden overflow, and where a rail does
 * not exist to hold them. Both read `destinations.ts`, so neither can list a section the other does
 * not.
 *
 * Two things keep this from being the old grouped nav coming back. Each destination is a LINK rather
 * than a heading, so nothing here is a heading arguing with its own contents. And a destination's
 * sections are drawn only while the operator is inside it, so the rail on any given page is the four
 * destinations, two pinned links, and one list.
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
    // Where the operator is, which is the only thing this asks the router. Read off it rather than
    // computed from a prop, so it cannot give a different answer than the `data-status` the links
    // themselves carry — the same rule `nav.footer.tsx` states for the sections it has always drawn.
    const pathname = useRouterState({ select: state => state.location.pathname });

    return (
        <Stack gap={2} py="xs">
            {NAV_DESTINATIONS.map(destination => (
                <Fragment key={destination.label}>
                    <NavItem
                        to={destination.to}
                        label={destination.label}
                        hint={destination.hint}
                        attention={typeof destination.to === 'string' ? counts.get(destination.to) : undefined}
                        // A destination with children uses an exact match, or it lights up beside
                        // whichever child is open and the rail says the operator is in two places.
                        // The Desk has none and keeps the router's prefix default.
                        {...(destination.sections.length > 0 ? { exact: true } : {})}
                    />

                    {/* Drawn only while the operator is inside this destination. Four destinations
                        with every section permanently listed is 24 rows of standing furniture, and
                        the rail's own argument for being flat was that a nav should be the places
                        you are choosing between rather than everywhere the console has. */}
                    {isInsideDestination(destination, pathname)
                        ? destination.sections.map(section => (
                              <NavItem
                                  key={section.label}
                                  to={section.to}
                                  search={section.search}
                                  label={section.label}
                                  hintText={section.hintText}
                                  nested
                                  attention={typeof section.to === 'string' ? counts.get(section.to) : undefined}
                              />
                          ))
                        : undefined}
                </Fragment>
            ))}
        </Stack>
    );
}
