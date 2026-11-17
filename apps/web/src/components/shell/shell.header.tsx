import { ActionIcon, AppShell, Box, Button, Group, Kbd, Text } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import { spotlight } from '@mantine/spotlight';
import { useTranslation } from 'react-i18next';
import type { ComponentProps } from 'react';
import type { AttentionItem } from '@deadair/sdk';

import { HeaderDestinations, HeaderPinned } from './header.nav';
import { OnAirChip } from './on.air.chip';
import { PhoneMenu } from './phone.menu';
import { StationClock } from './station.clock';
import { StationMark } from './station.mark';
import { StationTally } from './station.tally';
import { UpdateNotice } from './update.notice';

interface Props {
    signedIn: boolean;
    status: ComponentProps<typeof StationTally>['status'];
    /** What wants somebody, for the destinations' badges. */
    attention: readonly AttentionItem[] | undefined;
    loggingOut: boolean;
    onLogout: () => void;
}

/**
 * The bar across the top of every page, and since the rail went, the way around the console: the
 * four destinations as tabs, Check-up and Settings pinned right, and what is on air.
 */
export function ShellHeader({ signedIn, status, attention, loggingOut, onLogout }: Props) {
    const { t } = useTranslation('routes');

    return (
        <AppShell.Header className="da-scanlines">
            <Group h="100%" px="md" gap="md" wrap="nowrap">
                <Group gap="sm" wrap="nowrap" style={{ flexShrink: 0 }}>
                    <StationMark />
                    <Text ff="heading" fw={700} tt="uppercase" style={{ letterSpacing: 'var(--da-tracking-wordmark)' }}>
                        {t('root.wordmark')}
                    </Text>
                </Group>
                {/* Beside the wordmark rather than out at the right edge: this is what the
                station IS at this moment, so it reads as part of the identity rather than
                as one more control. The clock stays right, where a clock belongs. */}
                {signedIn ? <StationTally status={status} /> : undefined}
                {signedIn ? <HeaderDestinations attention={attention} /> : undefined}
                <Box style={{ flex: 1, minWidth: 0 }} />
                {/* What is on air, then Check-up and Settings, the way to anywhere, the clock and
                the menu. The right edge is where an operator looks for the state of the station
                and the way to move around it. */}
                {signedIn ? (
                    <Group gap="sm" wrap="nowrap" style={{ flexShrink: 0 }}>
                        <OnAirChip status={status} />
                        <HeaderPinned attention={attention} />
                        {/* Only when a newer release is out. See the component for why it is
                        here rather than in the attention list. */}
                        <UpdateNotice enabled={signedIn} />
                        <Button
                            variant="default"
                            size="compact-sm"
                            fw={400}
                            c="dimmed"
                            onClick={spotlight.open}
                            rightSection={<Kbd size="xs">⌘K</Kbd>}
                            visibleFrom="xl"
                        >
                            {t('root.jumpTo')}
                        </Button>
                        {/* The same door with no words on it, below the widest screens: the four
                        tabs and the chip take the room the label had. */}
                        <ActionIcon variant="default" size="lg" aria-label={t('root.jumpTo')} onClick={spotlight.open} hiddenFrom="xl">
                            <IconSearch size={18} stroke={1.8} />
                        </ActionIcon>
                        {/* Not on a phone: the phone's own status bar is already a clock an
                        inch away, and the 70px this frees is what keeps the corner's two
                        controls on the right side of the bezel. */}
                        <Box visibleFrom="sm">
                            <StationClock />
                        </Box>
                        {/* Logout, and on a phone Check-up and Settings too, which the header
                        has no room to pin there. */}
                        <PhoneMenu loggingOut={loggingOut} onLogout={onLogout} />
                    </Group>
                ) : undefined}
            </Group>
        </AppShell.Header>
    );
}
