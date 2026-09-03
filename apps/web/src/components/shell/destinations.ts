import type { LinkProps } from '@tanstack/react-router';

import { CHECKUP_ROUTES, CHECKUP_TABS } from '../station/checkup.shell';
import { LIBRARY_ROUTES, LIBRARY_TABS } from '../library/library.shell';
import { PROGRAMME_TABS } from '../schedule/schedule.page';
import { SETTINGS_ROUTES, SETTINGS_SECTIONS } from '../settings/settings.shell';
import { VOICE_TABS } from '../voice/voice.page';

/**
 * Everywhere the console goes, and what is under each of them.
 *
 * ## Why this exists
 *
 * Four destinations each grew a tab strip, and a strip is a good navigator for as long as it fits.
 * Voice's eight ran to 1122px inside a 964px rail at a 1200px window, so two of them — Productions
 * and What it said — were simply not on the screen, and picking one from the middle scrolled the
 * first two off the other end. There was no scrollbar to say so: the strip hides it.
 *
 * Settings had already solved this, and solved it a different way: ten sections were too many for a
 * strip, so they are rows in the rail underneath Settings. That left the console navigating one way
 * in five places and another way in one, and the odd one out was the one that worked.
 *
 * So the rail carries every destination's sections now and the strip is the phone's. This table is
 * what both of them read.
 *
 * ## It restates nothing
 *
 * Every label here comes from the destination's own tab table — `VOICE_TABS`, `LIBRARY_TABS`,
 * `PROGRAMME_TABS`, `CHECKUP_TABS`, `SETTINGS_SECTIONS` — imported rather than copied, on the same
 * argument the palette already makes: a tab added to Voice appears in the rail and in the palette
 * without anybody remembering this file. What this file adds is only the two things a tab table has
 * no opinion about: where each section goes as a `Link`, and which destination owns it.
 *
 * ## The link shape is the router's
 *
 * `Pick<LinkProps, ...>` for the reason `attention.destination.ts` gives at length: `to` typed as
 * `string` type-checks a tab against a destination that has none, and this console has already
 * shipped a nav entry pointing at a route that never existed. A section here is spread whole into a
 * `Link`, so nothing downstream restates the path.
 *
 * Voice and Programme are one route each with a `?tab=`; Library, Check-up and Settings are a route
 * per section. Both spellings are just a `Link`'s props, which is why they can sit in one list.
 */
export type NavLink = Pick<LinkProps, 'to' | 'search'>;

export interface NavSection extends NavLink {
    label: string;
    /** What is behind it, drawn as the row's tooltip. Straight off the tab table. */
    hintText?: string;
}

export interface NavDestination extends NavLink {
    label: string;
    /**
     * The key the shell binds to reach it.
     *
     * Only the four in the rail have one. A shortcut is for a place you go on purpose, which is the
     * same reason `nav.footer.tsx` gives for Check-up and Settings not having one.
     */
    hint?: string;
    sections: NavSection[];
}

/** The four the rail lists, in the order it lists them. Keys bound by the shell against this table. */
export const NAV_DESTINATIONS: NavDestination[] = [
    // Home and On air were two links and one question. The landing page was a masthead and a list of
    // faults, and the operator's next click was always the running order.
    { to: '/', label: 'Desk', hint: 'D', sections: [] },
    // Beside the desk: both answer "what is the station playing", one now and one later.
    {
        to: '/schedule',
        label: 'Programme',
        hint: 'P',
        sections: PROGRAMME_TABS.map(tab => ({ to: '/schedule', search: { tab: tab.key }, label: tab.label, hintText: tab.hint })),
    },
    // Four links became one destination. They are all answers to "what can this station put on", and
    // an operator arriving with that question had to already know whether the answer was a record, a
    // playlist, a chart or a story.
    {
        to: '/catalog/tracks',
        label: 'Library',
        hint: 'L',
        sections: LIBRARY_TABS.map(tab => ({ to: LIBRARY_ROUTES[tab.key], label: tab.label, hintText: tab.hint })),
    },
    // Eight links became one destination, and eight tabs are what stopped fitting. An operator does
    // not arrive wanting "the pronunciations page", they arrive because the station said a name
    // wrong — so the eight stay together and the rail is what lists them.
    //
    // `segment` and `persona` are emptied rather than omitted: both are part of this route's search
    // shape, and a rail row is how somebody asks for the whole of What it said rather than for the
    // one break a link happened to leave in the URL.
    {
        to: '/voice',
        label: 'Voice',
        hint: 'V',
        sections: VOICE_TABS.map(tab => ({
            to: '/voice',
            search: { tab: tab.key, segment: '', persona: '' },
            label: tab.label,
            hintText: tab.hint,
        })),
    },
];

/**
 * The two under the rule at the bottom, which are not destinations in the sense the four above are.
 *
 * Nobody opens the console to look at Settings; they arrive at it from something that sent them.
 * `nav.footer.tsx` draws these and has always drawn Settings' sections — this only puts Check-up's
 * four beside them, so the rule the rail now follows has no exception left in it.
 */
export const NAV_FOOTER_DESTINATIONS: NavDestination[] = [
    {
        to: '/checkup',
        label: 'Check-up',
        sections: CHECKUP_TABS.map(tab => ({ to: CHECKUP_ROUTES[tab.key], label: tab.label, hintText: tab.hint })),
    },
    {
        to: '/settings',
        label: 'Settings',
        sections: SETTINGS_SECTIONS.map(section => ({ to: SETTINGS_ROUTES[section.id], label: section.label, hintText: section.hint })),
    },
];

/** The letters the shell binds, read off the table that draws them. */
export const DESTINATION_KEYS: { hint: string; to: NavLink['to'] }[] = NAV_DESTINATIONS.flatMap(item =>
    item.hint === undefined ? [] : [{ hint: item.hint, to: item.to }],
);

/**
 * Whether the operator is inside a destination, which is what decides if its sections are drawn.
 *
 * A prefix match on the pathname, plus the two exceptions the console has always had. Library's own
 * tabs live under four different paths, so its sections show on any of them; and `/plugins` counts
 * as Settings, being a section of it that happens to have been a route first.
 *
 * Deliberately NOT a search-param comparison. Whether the rail is expanded is a question about the
 * destination, not about which of its sections is open — the router decides that second question for
 * itself, on each row's own `Link`.
 */
export function isInsideDestination(destination: NavDestination, pathname: string): boolean {
    const at = (path: string): boolean => pathname === path || pathname.startsWith(`${path}/`);

    if (destination.to === '/') return pathname === '/';
    if (destination.to === '/settings') return at('/settings') || at('/plugins');
    if (destination.to === '/catalog/tracks') return destination.sections.some(section => at(section.to as string));

    return at(destination.to as string);
}
