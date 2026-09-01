import type { ReactNode } from 'react';
import { Anchor, Badge, Box, Group, ScrollArea, Stack, Text, Title } from '@mantine/core';
import { Link } from '@tanstack/react-router';

import { EmbeddedPage } from '../shared/page.header';
import { useActiveSection } from './use.active.section';
import classes from './settings.shell.module.css';

/**
 * The sections an operator can jump to, and their anchor on the settings page.
 *
 * Kept beside the shell rather than inside `settings.page.tsx` because Plugins is one of them and
 * is not on that page: it is its own route, with a card per plugin, its own OAuth callbacks and a
 * detail page underneath. It belongs under Settings by subject — a plugin is a thing you configure
 * — and the section list is what makes that true for somebody navigating, without pretending a
 * whole page is a card.
 */
export const SETTINGS_SECTIONS = [
    { id: 'station', label: 'Station', hint: 'Name, mount and where it publishes' },
    // Second, and the only one on this page that changes nothing about the station. It is here
    // because "how do I make this readable in daylight" is a question an operator brings to
    // Settings, and the card itself says plainly that it is remembered on this browser alone.
    { id: 'appearance', label: 'Appearance', hint: 'How the console looks, on this browser' },
    { id: 'rotation', label: 'Rotation', hint: 'How it programmes itself' },
    { id: 'playout', label: 'Playout', hint: 'What puts it on air' },
    { id: 'render', label: 'Voice and audio', hint: 'How it speaks, and how a programme is assembled' },
    { id: 'llm', label: 'Words', hint: 'Which plugin it asks for words' },
    { id: 'analysis', label: 'Measurement', hint: 'Which plugin measures records' },
    { id: 'storage', label: 'Storage', hint: 'What the caches are holding' },
    { id: 'grants', label: 'Waiting on you', hint: 'What plugins have asked for' },
] as const;

/** Just the ids, in page order, for the scroll spy. Stable so the effect does not re-subscribe. */
const SECTION_IDS: readonly string[] = SETTINGS_SECTIONS.map(section => section.id);

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
                    {SETTINGS_SECTIONS.map(section => (
                        <Anchor
                            key={section.id}
                            href={active === 'settings' ? `#${section.id}` : undefined}
                            size="sm"
                            underline="never"
                            style={{ whiteSpace: 'nowrap' }}
                            renderRoot={active === 'settings' ? undefined : props => <Link to="/settings" hash={section.id} {...props} />}
                        >
                            {/* Mantine caps a `Badge` at the width of its container and clips the
                                label with an ellipsis, which turned this strip into "A…", "Voi…",
                                "Wa…" — chips that cannot be told apart are worse than no strip.
                                The row already scrolls, so there is nothing for a chip to overflow
                                and the cap has nothing to protect. */}
                            <Badge
                                variant={reading === section.id ? 'light' : 'default'}
                                size="lg"
                                radius="sm"
                                fw={400}
                                tt="none"
                                styles={{ root: { maxWidth: 'none' }, label: { overflow: 'visible' } }}
                            >
                                {section.label}
                            </Badge>
                        </Anchor>
                    ))}
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
                            const here = active === 'settings' && reading === section.id;
                            return (
                                <Anchor
                                    key={section.id}
                                    href={active === 'settings' ? `#${section.id}` : undefined}
                                    size="sm"
                                    c={active === 'settings' ? undefined : 'dimmed'}
                                    underline="never"
                                    py={6}
                                    px={10}
                                    // The bar was drawn transparent on every section and filled on
                                    // none of them, so the list said where you could go and never
                                    // where you were.
                                    style={{ borderLeft: `2px solid ${here ? 'var(--da-phosphor)' : 'transparent'}` }}
                                    // From the plugins page these are on another route, so they carry
                                    // the operator back rather than pointing at anchors that are not
                                    // in this document.
                                    renderRoot={active === 'settings' ? undefined : props => <Link to="/settings" hash={section.id} {...props} />}
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

                        <Anchor
                            size="sm"
                            underline="never"
                            py={6}
                            px={10}
                            fw={active === 'plugins' ? 600 : undefined}
                            style={{ borderLeft: `2px solid ${active === 'plugins' ? 'var(--da-phosphor)' : 'transparent'}` }}
                            renderRoot={(props: object) => <Link to="/plugins" {...props} />}
                        >
                            Plugins
                        </Anchor>

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
