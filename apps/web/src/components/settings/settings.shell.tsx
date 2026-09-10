import type { ReactNode } from 'react';
import { Anchor, Group, Stack, Text, Title } from '@mantine/core';
import { IconChevronLeft } from '@tabler/icons-react';
import { Link } from '@tanstack/react-router';
import type { StationSettingDescriptor } from '@deadair/sdk';

import { EmbeddedPage } from '../shared/page.header';
import { usePhone } from '../shared/use.phone';

/**
 * Every section there is.
 *
 * Written as a union rather than derived from the list below, which is the one bit of duplication
 * here and it buys two things worth more than it costs: `SETTINGS_ROUTES` is a `Record` over it, so
 * a section added without a route fails to compile, and `SettingsSection['id']` is narrow enough to
 * index that record — which a list-derived type cannot be while the list is typed by the interface.
 */
export type SettingsSectionId =
    | 'station'
    | 'stream'
    | 'housekeeping'
    | 'secrets'
    | 'mail'
    | 'appearance'
    | 'security'
    | 'rotation'
    | 'playout'
    | 'render'
    | 'llm'
    | 'analysis'
    | 'storage'
    | 'grants'
    | 'plugins';

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
    /**
     * What the section holds, which is the half a bare label leaves out.
     *
     * "Words" and "Measurement" name subjects rather than settings, so an operator looking for the
     * model has no way to tell which one to open. It was dropped when the sections became a strip of
     * tabs, which had nowhere to put it; the rail and the phone's list both do.
     */
    hint: string;
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
 * not name is drawn by whichever page claimed it. `schedule` is one — what the station plays
 * between blocks is edited beside the timetable that makes sense of it, by `SustainingPanel`, so
 * naming it here would draw those settings twice. `personas` is the other: the presenter name is
 * edited above the roster whose own names override it, by `PresenterNamePanel`.
 *
 * Plugins is a member rather than a special case appended at the end. It belongs under Settings by
 * subject — a plugin is a thing you configure — and it is why this list lives beside the shell
 * rather than inside the page: it is the one section that is a whole route.
 */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
    {
        id: 'station',
        label: 'Station',
        hint: 'Name, mount and where it publishes',
        group: 'station',
        blurb: 'What the station is called and where it publishes. Icecast and Liquidsoap read these from files rendered on save, so a change reaches them on their next restart.',
    },
    // Split out of Station along with the two below it: one save under thirty-one fields, from the
    // station's own name to four passwords, was a lot of ground to cover for a visit that usually
    // wants one of them. `SettingGroup` in `settings.types.ck` carries the same four-way split.
    {
        id: 'stream',
        label: 'Stream',
        hint: 'What puts it on air, in what formats',
        group: 'stream',
        blurb: 'The mounts the station publishes to: their formats and bitrates, HLS, and the Icecast connection they all go through. Icecast and Liquidsoap read these from files rendered on save, so a change reaches them on their next restart.',
    },
    {
        id: 'housekeeping',
        label: 'Housekeeping',
        hint: 'How long it keeps its own history',
        group: 'housekeeping',
        blurb: 'How long the station keeps its own history, and how much of a library sync it will trust before it refuses rather than throwing the rest away.',
    },
    {
        id: 'secrets',
        label: 'Secrets',
        hint: 'The passwords it was seeded with',
        group: 'secrets',
        blurb: 'Seeded with strong random values on first boot, so this is a page an operator visits only to match a password something else already has.',
    },
    // Beside Secrets because it is the other page of credentials, and immediately before Security
    // because it is what makes Security's second half work: the codes and sign-in links this
    // station sends go out through whatever is set here, and until something is, they do not go.
    {
        id: 'mail',
        label: 'Mail',
        hint: 'Where it sends sign-in codes from',
        group: 'mail',
        blurb: 'The mail server the station signs people in through. Without one it cannot send a code or a sign-in link, and it says so rather than failing quietly.',
    },
    // Second, and the only one on this page that changes nothing about the station. It is here
    // because "how do I make this readable in daylight" is a question an operator brings to
    // Settings, and the card itself says plainly that it is remembered on this browser alone.
    { id: 'appearance', label: 'Appearance', hint: 'How the console looks, on this browser' },
    // Beside Appearance because it is the other section about the operator rather than the
    // station: a second factor protects this person's sign-in, and enrolling one changes nothing
    // about what listeners hear.
    { id: 'security', label: 'Security', hint: 'How you sign in' },
    {
        id: 'rotation',
        label: 'Rotation',
        hint: 'How it programmes itself',
        group: 'rotation',
        blurb: 'How the station programmes itself when nothing more specific is asked for. A lineup can override any of these for itself, and a setlist or a feature ignores all of them.',
    },
    {
        id: 'playout',
        label: 'Playout',
        hint: 'What puts it on air',
        group: 'playout',
        blurb: 'What puts the station on air, and the secret the playout bridge is gated on.',
    },
    {
        id: 'render',
        label: 'Voice and audio',
        hint: 'How it speaks, and how a programme is assembled',
        group: 'render',
        blurb: 'How the station speaks, and how a programme written in parts is put together.',
    },
    {
        id: 'llm',
        label: 'Words',
        hint: 'Which plugin it asks for words',
        group: 'llm',
        blurb: 'Which plugin the station asks for words. With none set up it still writes its own breaks, from what is either side of them in the running order.',
    },
    {
        id: 'analysis',
        label: 'Measurement',
        hint: 'Which plugin measures records',
        group: 'analysis',
        blurb: 'Which plugin measures records, so the station can trim the dead air off each one and know how long it may talk over an intro. With none set up every track still plays, unmeasured.',
    },
    { id: 'storage', label: 'Storage', hint: 'What the caches are holding' },
    { id: 'grants', label: 'Waiting on you', hint: 'What plugins have asked for' },
    { id: 'plugins', label: 'Plugins', hint: 'What the station runs, and what they have asked for', route: '/plugins' },
];

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
    | '/settings/stream'
    | '/settings/housekeeping'
    | '/settings/secrets'
    | '/settings/mail'
    | '/settings/appearance'
    | '/settings/security'
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
    stream: '/settings/stream',
    housekeeping: '/settings/housekeeping',
    secrets: '/settings/secrets',
    mail: '/settings/mail',
    appearance: '/settings/appearance',
    security: '/settings/security',
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
    /**
     * Which section is being read, or nothing for the list of them.
     *
     * Only a phone reads this, and only to decide whether to draw the way back: on a desk the rail
     * says where the operator is, and it reads that off the router rather than off a prop.
     */
    active?: SettingsSectionId;
    children: ReactNode;
}

/**
 * The station itself, with its sections wherever this viewport keeps them.
 *
 * It has been three navigators. Nine cards in one column with a sticky list of anchors beside them,
 * where an operator who came to change the mount read four sections they did not want on the way.
 * Then a route per section with a strip of tabs, which is the shape every other destination here
 * uses and is the one that does not survive ten of them: 1298px of tabs against a phone's 358 means
 * most of the sections are off-screen while somebody is looking for one, and a strip has nowhere to
 * put the sentence saying what each one holds.
 *
 * Now neither. The rail lists them on a desk and `SettingsIndex` lists them on a phone, so this
 * draws the destination and gets out of the way.
 *
 * **The sections still save one at a time.** The API write is partial, so a section cannot clear
 * another, and the line under the title is where that is said.
 */
export function SettingsShell({ active, children }: SettingsShellProps) {
    const phone = usePhone();

    // The rail is collapsed on a phone, so a section reached from the list has nothing to get back
    // to it with. On a desk the rail is the way back and a second one would be clutter.
    const back = phone && active !== undefined;

    return (
        <Stack gap="lg">
            <Stack gap="xxs">
                {back ? (
                    <Anchor size="sm" underline="never" c="dimmed" w="fit-content" renderRoot={(props: object) => <Link to="/settings" {...props} />}>
                        <Group gap={4} wrap="nowrap">
                            <IconChevronLeft aria-hidden size={14} stroke={2} />
                            All settings
                        </Group>
                    </Anchor>
                ) : undefined}

                <Title order={1}>Settings</Title>
                <Text size="sm" c="dimmed" maw={760}>
                    The station itself, and the plugins it runs. Every section saves on its own, and nothing here can clear another. What plays
                    between blocks is on Programme instead, beside the timetable that makes sense of it.
                </Text>
            </Stack>

            {/* Stops each section drawing a second `<h1>` under the destination's own. */}
            <EmbeddedPage>{children}</EmbeddedPage>
        </Stack>
    );
}
