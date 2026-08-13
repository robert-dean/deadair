import { Badge, Group, Stack, Text, Title } from '@mantine/core';

import { usePlayoutStatus } from '../api/playout.queries';
import { OnAirBadge } from './playout/on.air.badge';

export function HomePage() {
    // Shares the poll the shell is already running: same query key, same cache, no
    // second request. Enabled unconditionally because this page only renders behind
    // the router's auth gate.
    const playout = usePlayoutStatus(true);

    return (
        <Stack gap="md">
            <Group gap="sm">
                <Title order={1}>deadair</Title>
                {playout.data ? (
                    <OnAirBadge silence={playout.data.silence} />
                ) : (
                    // Not "off air": nothing has been heard from the station yet, and
                    // guessing either way is the one thing a tally light must not do.
                    <Badge variant="light" color="gray">
                        …
                    </Badge>
                )}
            </Group>
            <Text c="dimmed" maw={560}>
                A self-driving internet radio station. deadair holds the mount on a lease it renews only while it has something to play, so what you
                hear is always something the station chose.
            </Text>
        </Stack>
    );
}
