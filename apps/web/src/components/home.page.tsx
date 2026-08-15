import { Group, Image, Stack, Text, Title } from '@mantine/core';

import { usePlayoutStatus } from '../api/playout.queries';
import { OnAirBadge } from './playout/on.air.badge';
import { Eyebrow } from './shared/eyebrow';
import { StatusLamp } from './shared/status.lamp';

export function HomePage() {
    // Shares the poll the shell is already running: same query key, same cache, no
    // second request. Enabled unconditionally because this page only renders behind
    // the router's auth gate.
    const playout = usePlayoutStatus(true);

    return (
        <Group align="flex-start" gap="xl" wrap="nowrap" pt="md">
            {/* The full lockup, and the only place it appears: everywhere else in the console the
                arched type is too small to read and the skull alone does the job. Hidden from
                assistive technology because the heading beside it already says the name. */}
            <Image src="/logo.png" alt="" aria-hidden w={132} h={132} visibleFrom="xs" style={{ flexShrink: 0 }} />
            <Stack gap="xs" maw={560}>
                <Eyebrow>Station</Eyebrow>
                <Group gap="sm" align="center">
                    <Title order={1}>deadair</Title>
                    {playout.data ? (
                        <OnAirBadge silence={playout.data.silence} />
                    ) : (
                        // Not "off air": nothing has been heard from the station yet, and
                        // guessing either way is the one thing a tally light must not do.
                        <StatusLamp tone="off" label="…" emphasis="chip" />
                    )}
                </Group>
                <Text c="dimmed">
                    A self-driving internet radio station. deadair holds the mount on a lease it renews only while it has something to play, so what
                    you hear is always something the station chose.
                </Text>
            </Stack>
        </Group>
    );
}
