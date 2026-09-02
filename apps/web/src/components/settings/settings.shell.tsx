import type { ReactNode } from 'react';
import { Anchor, Badge, Box, Group, ScrollArea, Stack, Text, Title } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import type { StationSettingDescriptor } from '@deadair/sdk';

import { EmbeddedPage } from '../shared/page.header';
import { useActiveSection } from './use.active.section';
import classes from './settings.shell.module.css';

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
    id: string;
    label: string;
    /** What the section holds, which is the half a bare label leaves out. */
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
 * **This is the only list.** It was two — the labels and hints here, and a parallel `GROUPS` in
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
const SECTIONS = [
    {
        id: 'station',
        label: 'Station',
        hint: 'Name, mount and where it publishes',
        group: 'station',
        blurb: 'What the station is called and where it publishes. Icecast and Liquidsoap read these from files rendered on save, so a change reaches them on their next restart.',
    },
    // Second, and the only one on this page that changes nothing about the station. It is here
    // because "how do I make this readable in daylight" is a question an operator brings to
    // Settings, and the card itself says plainly that it is remembered on this browser alone.
    { id: 'appearance', label: 'Appearance', hint: 'How the console looks, on this browser' },
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
] as const satisfies readonly SettingsSection[];

/** Every section's id, as a union, so a caller naming one that does not exist fails to compile. */
export type SettingsSectionId = (typeof SECTIONS)[number]['id'];

/**
 * The list as the interface rather than as the literal tuple.
 *
 * `as const satisfies` above buys both halves, wanted in different places: the tuple keeps
 * {@link SettingsSectionId} exact, and this view lets a caller read `group` or `route` off a section
 * without TypeScript objecting that some members do not have one.
 */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = SECTIONS;

/**
 * Just the anchors, in page order, for the scroll spy. Stable so the effect does not re-subscribe.
 *
 * A section that is a route of its own has no anchor in this document, so it is not something the
 * spy could find and asking it to look would light nothing.
 */
const SECTION_IDS: readonly string[] = SETTINGS_SECTIONS.filter(section => section.route === undefined).map(section => section.id);

/** Module-level, for the same reason: a fresh `[]` per render would re-run the spy's effect. */
const EMPTY_SECTIONS: readonly string[] = [];

export interface SettingsShellProps {
    /** `settings` for the station's own sections, `plugins` for the plugin list. */
    active: 'settings' | 'plugins';
    children: ReactNode;
}

/**
 * The station itself, with a way to jump straight to the part you came for.
 *
 * Six cards in one 720px column meant six scrolls, and an operator who came to change the mount
 * read four sections they did not want on the way. The list stays put beside them.
 *
 * **The sections still save one at a time.** Nothing about this changes that, and it is worth being
 * explicit: a settings page whose single button writes forty keys makes every change feel
 * consequential. The list is navigation, not a form.
 */
export function SettingsShell({ active, children }: SettingsShellProps) {
    // Only meaningful on this page: from Plugins the anchors are on another route, so there is no
    // section being read and nothing to light up.
    const reading = useActiveSection(active === 'settings' ? SECTION_IDS : EMPTY_SECTIONS);

    return (
        <Stack gap="lg">
            <Stack gap="xxs">
                <Title order={1}>Settings</Title>
                <Text size="sm" c="dimmed" maw={760}>
                    The station itself, and the plugins it runs. What plays between blocks is on Programme instead, beside the timetable that makes
                    sense of it.
                </Text>
            </Stack>

            {/* The same list, for a viewport with no room for a column beside the cards. Without it
                everything below `md` is nine cards and one long scroll with no way to skip — which
                is the complaint the sidebar was added to answer, left unanswered on a phone. */}
            <ScrollArea type="never" hiddenFrom="md">
                <Group gap="xs" wrap="nowrap" pb={4}>
                    {SETTINGS_SECTIONS.map(section => {
                        // Held rather than read twice: narrowing `section.route` does not survive
                        // into the `renderRoot` closure below, and `to` will not take a `string`.
                        const route = section.route;
                        const here = route === undefined ? active === 'settings' && reading === section.id : active === 'plugins';

                        return (
                            <Anchor
                                key={section.id}
                                href={route === undefined && active === 'settings' ? `#${section.id}` : undefined}
                                size="sm"
                                underline="never"
                                style={{ whiteSpace: 'nowrap' }}
                                renderRoot={
                                    route !== undefined
                                        ? (props: object) => <Link to={route} {...props} />
                                        : active === 'settings'
                                          ? undefined
                                          : (props: object) => <Link to="/settings" hash={section.id} {...props} />
                                }
                            >
                                {/* Mantine caps a `Badge` at the width of its container and clips
                                    the label with an ellipsis, which turned this strip into "A…",
                                    "Voi…", "Wa…" — chips that cannot be told apart are worse than
                                    no strip. The row already scrolls, so there is nothing for a
                                    chip to overflow and the cap has nothing to protect. */}
                                <Badge
                                    variant={here ? 'light' : 'default'}
                                    size="lg"
                                    radius="sm"
                                    fw={400}
                                    tt="none"
                                    styles={{ root: { maxWidth: 'none' }, label: { overflow: 'visible' } }}
                                >
                                    {section.label}
                                </Badge>
                            </Anchor>
                        );
                    })}
                </Group>
            </ScrollArea>

            <Box className={classes.grid}>
                <Box
                    component="nav"
                    aria-label="Settings sections"
                    // Sticky under the header rather than scrolling away with the first card: the
                    // whole point of the list is to be there when you are three sections down.
                    style={{ position: 'sticky', top: 76, alignSelf: 'start' }}
                    visibleFrom="md"
                >
                    <Stack gap={2}>
                        {SETTINGS_SECTIONS.map(section => {
                            // See the strip above: held so the closure keeps the narrowed type.
                            const route = section.route;
                            const here = route === undefined ? active === 'settings' && reading === section.id : active === 'plugins';

                            return (
                                <Anchor
                                    key={section.id}
                                    href={route === undefined && active === 'settings' ? `#${section.id}` : undefined}
                                    size="sm"
                                    c={route === undefined && active !== 'settings' ? 'dimmed' : undefined}
                                    underline="never"
                                    py={6}
                                    px={10}
                                    // The bar was drawn transparent on every section and filled on
                                    // none of them, so the list said where you could go and never
                                    // where you were.
                                    style={{ borderLeft: `2px solid ${here ? 'var(--da-phosphor)' : 'transparent'}` }}
                                    // From the plugins page these are on another route, so they
                                    // carry the operator back rather than pointing at anchors that
                                    // are not in this document.
                                    renderRoot={
                                        route !== undefined
                                            ? (props: object) => <Link to={route} {...props} />
                                            : active === 'settings'
                                              ? undefined
                                              : (props: object) => <Link to="/settings" hash={section.id} {...props} />
                                    }
                                >
                                    <Stack gap={0}>
                                        <Text size="sm" fw={here ? 600 : undefined} inherit>
                                            {section.label}
                                        </Text>
                                        {/* What the section holds, which is the half a bare label
                                            leaves out: "Words" and "Measurement" name subjects
                                            rather than settings, and an operator looking for the
                                            model has no way to tell which one to open. */}
                                        <Text size="xs" c="dimmed" lh={1.3}>
                                            {section.hint}
                                        </Text>
                                    </Stack>
                                </Anchor>
                            );
                        })}

                        <Text size="xs" c="dimmed" mt="xs" px={10}>
                            Every section saves on its own. Nothing here can clear another.
                        </Text>
                    </Stack>
                </Box>

                <Box style={{ minWidth: 0 }}>
                    <EmbeddedPage>{children}</EmbeddedPage>
                </Box>
            </Box>
        </Stack>
    );
}
