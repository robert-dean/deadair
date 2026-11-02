import { ActionIcon, AppShell, Box, Button, Group, Kbd, Text } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import { spotlight } from '@mantine/spotlight';
import { useTranslation } from 'react-i18next';
import type { ComponentProps } from 'react';

import { PhoneMenu } from './phone.menu';
import { StationClock } from './station.clock';
import { StationMark } from './station.mark';
import { StationTally } from './station.tally';
import { UpdateNotice } from './update.notice';

interface Props {
    signedIn: boolean;
    status: ComponentProps<typeof StationTally>['status'];
    loggingOut: boolean;
    onLogout: () => void;
}

/** Split out of `__root.tsx` unchanged: the bar across the top of every page. */
export function ShellHeader({ signedIn, status, loggingOut, onLogout }: Props) {
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
                <Box style={{ flex: 1, minWidth: 0 }} />
                {/* The way to anywhere, and the clock. Logout was in this corner and is in the
                rail's footer now: the header's right edge is where an operator looks for
                the state of the station and the way to move around it, and a control for
                ending your session is neither. */}
                {signedIn ? (
                    <Group gap="sm" wrap="nowrap" style={{ flexShrink: 0 }}>
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
                            visibleFrom="sm"
                        >
                            {t('root.jumpTo')}
                        </Button>
                        {/* The same door with no keycap on it: a phone has no ⌘K, and a button
                        reading "Jump to anything" is wider than the header can spare. */}
                        <ActionIcon variant="default" size="lg" aria-label={t('root.jumpTo')} onClick={spotlight.open} hiddenFrom="sm">
                            <IconSearch size={18} stroke={1.8} />
                        </ActionIcon>
                        {/* Not on a phone: the phone's own status bar is already a clock an
                        inch away, and the 70px this frees is what keeps the corner's two
                        controls on the right side of the bezel. */}
                        <Box visibleFrom="sm">
                            <StationClock />
                        </Box>
                        {/* The rail's footer, for a viewport that has no rail — see the
                        component for why this is not the drawer coming back. */}
                        <PhoneMenu loggingOut={loggingOut} onLogout={onLogout} />
                    </Group>
                ) : undefined}
            </Group>
        </AppShell.Header>
    );
}
