import type { ReactNode } from 'react';
import { Stack, Text, Title } from '@mantine/core';
import { useNavigate } from '@tanstack/react-router';
import type { StationSettingDescriptor } from '@deadair/sdk';

import { DestinationTabs, type DestinationTab } from '../shared/destination.tabs';
import { EmbeddedPage } from '../shared/page.header';

/**
 * Every section there is.
 *
 * Written as a union rather than derived from the list below, which is the one bit of duplication
 * here and it buys two things worth more than it costs: `SETTINGS_ROUTES` is a `Record` over it, so
 * a section added without a route fails to compile, and `SettingsSection['id']` is narrow enough to
 * index that record — which a list-derived type cannot be while the list is typed by the interface.
 */
export type SettingsSectionId = 'station' | 'appearance' | 'rotation' | 'playout' | 'render' | 'llm' | 'analysis' | 'storage' | 'grants' | 'plugins';

/**
 * One section of Settings: what it is called, and where its contents come from.
 *
 * The fields split three ways and the split is the mechanism rather than convenience:
 *
 * - A section with a `group` draws that group's declared settings, and its `blurb` is the sentence
 *   under the heading. Six of them.
 * - A section with neither draws a card of its own that answers to nothing in the registry:
 *   Appearance writes to this browser, Storage is read-only, Grants is somebody else's question.
 * - A section with a `route` is not a card at all. Plugins is its own page.
 */
export interface SettingsSection {
    id: SettingsSectionId;
    label: string;
    /** The declared group this section draws, for the six that draw one. */
    group?: StationSettingDescriptor['group'];
    /** The sentence under the heading. Only a section with a `group` has one. */
    blurb?: string;
    /** The route this section IS, for the one that is a page rather than a card. */
    route?: '/plugins';
}

/**
 * The sections an operator can jump to, in the order they should meet them.
 *
 * **This is the only list.** It was two — the labels here, and a parallel `GROUPS` in
 * `settings.page.tsx` holding the group key and the blurb — so a new section had to be added to
 * both, and a group named in neither was invisible with nothing to catch it. The registry says so
 * in as many words at `settings.registry.ts:145`, and it is right that no test could see it: the
 * page drew what its own list named, so a group nothing named simply never appeared.
 *
 * Not every declared group is here, and the omission is still the mechanism: a group this list does
 * not name is drawn by whichever page claimed it. `schedule` is the one — what the station plays
 * between blocks is edited beside the timetable that makes sense of it, by `SustainingPanel`, so
 * naming it here would draw those five settings twice.
 *
 * Plugins is a member rather than a special case appended at the end. It belongs under Settings by
 * subject — a plugin is a thing you configure — and it is why this list lives beside the shell
 * rather than inside the page: it is the one section that is a whole route.
 */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
    {
        id: 'station',
        label: 'Station',
        group: 'station',
        blurb: 'What the station is called and where it publishes. Icecast and Liquidsoap read these from files rendered on save, so a change reaches them on their next restart.',
    },
    // Second, and the only one on this page that changes nothing about the station. It is here
    // because "how do I make this readable in daylight" is a question an operator brings to
    // Settings, and the card itself says plainly that it is remembered on this browser alone.
    { id: 'appearance', label: 'Appearance' },
    {
        id: 'rotation',
        label: 'Rotation',
        group: 'rotation',
        blurb: 'How the station programmes itself when nothing more specific is asked for. A lineup can override any of these for itself, and a setlist or a feature ignores all of them.',
    },
    {
        id: 'playout',
        label: 'Playout',
        group: 'playout',
        blurb: 'What puts the station on air, and the secret the playout bridge is gated on.',
    },
    {
        id: 'render',
        label: 'Voice and audio',
        group: 'render',
        blurb: 'How the station speaks, and how a programme written in parts is put together.',
    },
    {
        id: 'llm',
        label: 'Words',
        group: 'llm',
        blurb: 'Which plugin the station asks for words. With none set up it still writes its own breaks, from what is either side of them in the running order.',
    },
    {
        id: 'analysis',
        label: 'Measurement',
        group: 'analysis',
        blurb: 'Which plugin measures records, so the station can trim the dead air off each one and know how long it may talk over an intro. With none set up every track still plays, unmeasured.',
    },
    { id: 'storage', label: 'Storage' },
    { id: 'grants', label: 'Waiting on you' },
    { id: 'plugins', label: 'Plugins', route: '/plugins' },
];

/**
 * The strip, in list order.
 *
 * Derived rather than declared beside the list, which is the whole reason the list carries labels:
 * a tab and a section are the same thing said once.
 */
const SETTINGS_TABS: readonly DestinationTab<SettingsSectionId>[] = SETTINGS_SECTIONS.map(section => ({ key: section.id, label: section.label }));

/**
 * Where each section goes. Separate from the list above so the labels stay free of route strings.
 *
 * Exported because the command palette navigates to these too, and a second copy of this table is a
 * second place for a section and its route to come apart. The same division `LIBRARY_ROUTES` makes.
 *
 * Heterogeneous on purpose: nine of these are pages under `/settings` and Plugins is not, because it
 * was a route of its own long before the others were. A section is a place; where the place happens
 * to live in the URL is this table's business and nobody else's.
 */
export const SETTINGS_ROUTES: Record<
    SettingsSectionId,
    | '/settings/station'
    | '/settings/appearance'
    | '/settings/rotation'
    | '/settings/playout'
    | '/settings/render'
    | '/settings/llm'
    | '/settings/analysis'
    | '/settings/storage'
    | '/settings/grants'
    | '/plugins'
> = {
    station: '/settings/station',
    appearance: '/settings/appearance',
    rotation: '/settings/rotation',
    playout: '/settings/playout',
    render: '/settings/render',
    llm: '/settings/llm',
    analysis: '/settings/analysis',
    storage: '/settings/storage',
    grants: '/settings/grants',
    plugins: '/plugins',
};

export interface SettingsShellProps {
    /** Which section is being read. Every settings route names its own. */
    active: SettingsSectionId;
    children: ReactNode;
}

/**
 * The station itself, as a destination with a tab per section.
 *
 * It was nine cards in one 720px column with a sticky list of anchors beside them, and an operator
 * who came to change the mount read four sections they did not want on the way. Each section is its
 * own route now, so the strip is navigation between pages rather than a scroll position.
 *
 * **The sections still save one at a time**, which is worth being explicit about because the tabs
 * make it look more like one form than the cards ever did: a settings page whose single button
 * writes forty keys makes every change feel consequential. The API write is partial, so a section
 * cannot clear another, and the line under the title says so where the section list used to.
 */
export function SettingsShell({ active, children }: SettingsShellProps) {
    const navigate = useNavigate();

    return (
        <Stack gap="lg">
            <Stack gap="xxs">
                <Title order={1}>Settings</Title>
                <Text size="sm" c="dimmed" maw={760}>
                    The station itself, and the plugins it runs. Every section saves on its own, and nothing here can clear another. What plays
                    between blocks is on Programme instead, beside the timetable that makes sense of it.
                </Text>
            </Stack>

            {/* One strip for both widths, where this was a sticky column beside the cards and a
                scrolling row of chips below `md`. Two navigations for one list was two things to
                keep in step, and the phone's copy never offered Plugins at all. */}
            <DestinationTabs
                tabs={SETTINGS_TABS}
                active={active}
                label="Settings"
                onSelect={key => {
                    // Each section is its own route, so this is a real navigation rather than a
                    // state change: the back button steps between them, and an unsaved edit is
                    // caught by the guard on the section being left.
                    void navigate({ to: SETTINGS_ROUTES[key] });
                }}
            />

            {/* Stops each section drawing a second `<h1>` under the destination's own. */}
            <EmbeddedPage>{children}</EmbeddedPage>
        </Stack>
    );
}
