import { Spotlight, type SpotlightActionGroupData } from '@mantine/spotlight';
import { useNavigate } from '@tanstack/react-router';

import { LIBRARY_ROUTES, LIBRARY_TABS } from '../library/library.shell';
import { PROGRAMME_TABS } from '../schedule/schedule.page';
import { SETTINGS_SECTIONS } from '../settings/settings.shell';
import { CHECKUP_ROUTES, CHECKUP_TABS } from '../station/checkup.shell';
import { VOICE_TABS } from '../voice/voice.page';

/**
 * Every place the console has, behind one box.
 *
 * ## Why this exists at all
 *
 * Nineteen nav links became four destinations, which is the right shape for arriving and the wrong
 * one for going somewhere specific. An operator who wants the pronunciations table now has to know
 * it is a tab on Voice; one who wants the mount has to know it is the Station section of Settings.
 * The tabs are the answer to "what else is here", and this is the answer to "I already know what I
 * want" — the two are not the same question and the console had only one of them.
 *
 * ## It is navigation, and nothing else
 *
 * No track search, no plugin list, no recent anything. Every action here is known at build time, so
 * the box opens instantly, is complete the moment it opens, and cannot show a spinner or a stale
 * name. A palette that sometimes answers is worse than one that always answers a smaller question:
 * the whole value of the thing is that you type without looking.
 *
 * ## The lists are the destinations' own
 *
 * `VOICE_TABS`, `LIBRARY_TABS`, `PROGRAMME_TABS`, `CHECKUP_TABS` and `SETTINGS_SECTIONS` are the
 * tables their own tab strips are drawn from, imported rather than restated. A tab added to Voice is
 * in the palette without anybody remembering this file, which is the only version of this that stays
 * true.
 */
export function JumpTo() {
    const navigate = useNavigate();

    const groups: SpotlightActionGroupData[] = [
        {
            group: 'Destinations',
            actions: [
                {
                    id: 'desk',
                    label: 'Desk',
                    description: 'What is going out, what needs you, and what is next',
                    onClick: () => void navigate({ to: '/' }),
                },
            ],
        },
        {
            group: 'Programme',
            actions: PROGRAMME_TABS.map(tab => ({
                id: `programme:${tab.key}`,
                label: tab.label,
                description: 'Programme',
                // No `replace`, unlike the tab strip. A strip replaces because stepping between
                // three tabs should not become three back-button presses to leave the destination.
                // A jump from the palette comes from somewhere else entirely, and replacing that
                // entry is how Back stops taking you where you were.
                onClick: () => void navigate({ to: '/schedule', search: { tab: tab.key } }),
            })),
        },
        {
            group: 'Library',
            actions: LIBRARY_TABS.map(tab => ({
                id: `library:${tab.key}`,
                label: tab.label,
                description: 'Library',
                onClick: () => void navigate({ to: LIBRARY_ROUTES[tab.key] }),
            })),
        },
        {
            group: 'Voice',
            actions: VOICE_TABS.map(tab => ({
                id: `voice:${tab.key}`,
                label: tab.label,
                description: 'Voice',
                onClick: () => void navigate({ to: '/voice', search: { tab: tab.key } }),
            })),
        },
        {
            group: 'Check-up',
            actions: CHECKUP_TABS.map(tab => ({
                id: `checkup:${tab.key}`,
                label: tab.label,
                description: 'Check-up',
                onClick: () => void navigate({ to: CHECKUP_ROUTES[tab.key] }),
            })),
        },
        {
            group: 'Settings',
            actions: [
                ...SETTINGS_SECTIONS.map(section => ({
                    id: `settings:${section.id}`,
                    label: section.label,
                    description: 'Settings',
                    // A hash rather than a route: these are cards on one page, and the section list
                    // beside them jumps the same way. `scrollMarginTop` on each card is what keeps
                    // the sticky header off the heading it just landed on.
                    onClick: () => void navigate({ to: '/settings', hash: section.id }),
                })),
                {
                    id: 'settings:plugins',
                    label: 'Plugins',
                    description: 'Settings',
                    onClick: () => void navigate({ to: '/plugins' }),
                },
            ],
        },
    ];

    return (
        <Spotlight
            actions={groups}
            shortcut="mod + K"
            nothingFound="No page by that name."
            highlightQuery
            scrollable
            maxHeight={420}
            searchProps={{ placeholder: 'Jump to anything' }}
        />
    );
}
