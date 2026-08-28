import type { ReactNode } from 'react';
import { Anchor, Box, Stack, Text, Title } from '@mantine/core';
import { Link } from '@tanstack/react-router';

import { EmbeddedPage } from '../shared/page.header';
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
    { id: 'station', label: 'Station' },
    // Second, and the only one on this page that changes nothing about the station. It is here
    // because "how do I make this readable in daylight" is a question an operator brings to
    // Settings, and the card itself says plainly that it is remembered on this browser alone.
    { id: 'appearance', label: 'Appearance' },
    { id: 'rotation', label: 'Rotation' },
    { id: 'playout', label: 'Playout' },
    { id: 'render', label: 'Voice and audio' },
    { id: 'llm', label: 'Words' },
    { id: 'analysis', label: 'Measurement' },
    { id: 'storage', label: 'Storage' },
    { id: 'grants', label: 'Waiting on you' },
] as const;

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
    return (
        <Stack gap="lg">
            <Stack gap="xxs">
                <Title order={1}>Settings</Title>
                <Text size="sm" c="dimmed" maw={760}>
                    The station itself, and the plugins it runs. What plays between blocks is on Programme instead, beside the timetable that makes
                    sense of it.
                </Text>
            </Stack>

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
                        {SETTINGS_SECTIONS.map(section => (
                            <Anchor
                                key={section.id}
                                href={active === 'settings' ? `#${section.id}` : undefined}
                                size="sm"
                                c={active === 'settings' ? undefined : 'dimmed'}
                                underline="never"
                                py={6}
                                px={10}
                                style={{ borderLeft: '2px solid transparent' }}
                                // From the plugins page these are on another route, so they carry
                                // the operator back rather than pointing at anchors that are not
                                // in this document.
                                renderRoot={active === 'settings' ? undefined : props => <Link to="/settings" hash={section.id} {...props} />}
                            >
                                {section.label}
                            </Anchor>
                        ))}

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
