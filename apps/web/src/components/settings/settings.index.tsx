import { Card, Group, Stack, Text } from '@mantine/core';
import { IconChevronRight } from '@tabler/icons-react';
import { Link } from '@tanstack/react-router';

import { SETTINGS_ROUTES, SETTINGS_SECTIONS } from './settings.shell';
import classes from './settings.index.module.css';

/**
 * Every section, as a list to tap through.
 *
 * The phone's front door, and only the phone's: the rail is what navigates Settings on a desk, and
 * it is collapsed below `sm`. Without this a phone would have the sections nowhere at all — the
 * bottom bar holds four destinations by design and the kebab holds one flat Settings item.
 *
 * The hint under each label is the whole reason this is a list rather than a menu. Several sections
 * name a subject rather than a setting, so "Words" and "Measurement" tell an operator looking for
 * the model nothing about which one to open, and a menu has nowhere to say it. That sentence was
 * deleted once already to make a strip of tabs fit; this is the second surface built to carry it.
 */
export function SettingsIndex() {
    return (
        <Stack gap="xs">
            {SETTINGS_SECTIONS.map(section => (
                <Card
                    key={section.id}
                    padding="md"
                    className={classes.row}
                    // A whole card is the tap target rather than the label inside it, which is the
                    // difference between a list that works with a thumb and one that works with a
                    // mouse. See the note on `renderRoot` in `apps/web/CLAUDE.md`: the annotation is
                    // what keeps `to` checked against routes that exist.
                    renderRoot={(props: object) => <Link to={SETTINGS_ROUTES[section.id]} {...props} />}
                >
                    <Group justify="space-between" wrap="nowrap" gap="md">
                        <Stack gap={2}>
                            <Text size="sm" fw={600}>
                                {section.label}
                            </Text>
                            <Text size="xs" c="dimmed" lh={1.3}>
                                {section.hint}
                            </Text>
                        </Stack>

                        {/* Says the row goes somewhere, which a card on its own does not. Hidden
                            from a screen reader: the row is a link and already announces itself as
                            one, so this would be a second, wordless copy of that. */}
                        <IconChevronRight aria-hidden size={16} stroke={1.8} style={{ flexShrink: 0, color: 'var(--da-text-dimmed)' }} />
                    </Group>
                </Card>
            ))}
        </Stack>
    );
}
