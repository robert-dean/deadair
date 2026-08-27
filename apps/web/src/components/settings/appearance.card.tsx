import { Box, Card, Group, SimpleGrid, Stack, Text, Title, UnstyledButton } from '@mantine/core';

import { setTheme, useThemeId } from '../../theme.store';
import { THEME_ORDER, THEMES, type ThemeDefinition } from '../../themes';
import { Eyebrow } from '../shared/eyebrow';

/**
 * Three ways to read the same console.
 *
 * ## Why this is a setting and not a station setting
 *
 * Everything else on this page is written to `deadair.settings` and is true of the station: change
 * the mount and every listener hears it. This is true of one browser. It sits among them anyway,
 * second, because "how do I make this readable in daylight" is a question an operator brings to
 * Settings — and the footnote says plainly that nothing about the station changes, which is the
 * whole of what somebody needs to know about the difference.
 *
 * ## The swatch is the theme, not a picture of it
 *
 * Each card draws that theme's four load-bearing colours in the proportion the console uses them —
 * desk, panel, accent, tally — and sets its own name in its own display face. A row of three labels
 * would make the choice a guess; this way an operator picks the one they can already see.
 */
export function AppearanceCard() {
    const chosen = useThemeId();

    return (
        // The anchor the section list and the command palette both jump to. `scrollMarginTop` clears
        // the sticky header, which would otherwise land on top of the heading it just scrolled to.
        <Card padding="lg" id="appearance" style={{ scrollMarginTop: 76 }}>
            <Stack gap="md">
                <Stack gap="xxs">
                    <Title order={2} size="h4">
                        Appearance
                    </Title>
                    <Text size="sm" c="dimmed">
                        Three ways to read the same console. The tally stays red in every one of them.
                    </Text>
                </Stack>

                <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
                    {THEME_ORDER.map(id => (
                        <ThemeChoice key={id} theme={THEMES[id]} chosen={id === chosen} />
                    ))}
                </SimpleGrid>

                <Text size="xs" c="dimmed">
                    Remembered on this browser. Nothing else about the station changes.
                </Text>
            </Stack>
        </Card>
    );
}

function ThemeChoice({ theme, chosen }: { theme: ThemeDefinition; chosen: boolean }) {
    return (
        <UnstyledButton
            aria-pressed={chosen}
            onClick={() => {
                setTheme(theme.id);
            }}
            p="sm"
            style={{
                borderRadius: 'var(--mantine-radius-sm)',
                background: 'var(--da-raised)',
                border: `1px solid ${chosen ? 'var(--da-phosphor)' : 'var(--da-border)'}`,
            }}
        >
            <Stack gap="xs">
                {/* The bands are that theme's own hexes rather than variables: this is the ONE place
                    a colour has to be drawn outside the theme that owns it, because all three are on
                    screen at once and two of them are not the one in force. */}
                <Group gap={3} h={40} wrap="nowrap" style={{ borderRadius: 'var(--mantine-radius-xs)', overflow: 'hidden' }}>
                    <Box style={{ flex: 3, alignSelf: 'stretch', background: theme.swatches[0] }} />
                    <Box style={{ flex: 1, alignSelf: 'stretch', background: theme.swatches[1] }} />
                    <Box style={{ flex: 1, alignSelf: 'stretch', background: theme.swatches[2] }} />
                    <Box w={8} style={{ alignSelf: 'stretch', background: theme.swatches[3] }} />
                </Group>

                <Group gap="xs" wrap="nowrap">
                    <Text size="sm" fw={600}>
                        {theme.name}
                    </Text>
                    {chosen ? <Eyebrow c="var(--da-phosphor)">in use</Eyebrow> : undefined}
                </Group>

                <Text size="xs" c="dimmed">
                    {theme.blurb}
                </Text>
                <Text size="xs" c="var(--da-text-secondary)" ff={theme.displayFont}>
                    {theme.typeLabel}
                </Text>
            </Stack>
        </UnstyledButton>
    );
}
