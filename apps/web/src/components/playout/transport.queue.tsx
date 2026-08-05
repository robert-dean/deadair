import { Group, ScrollArea, Stack, Text } from '@mantine/core';
import type { PlayoutItem } from '@deadair/sdk';

import { formatDuration } from '../shared/format.duration';

export interface TransportQueueProps {
    /** The head of the running order, as the API chose to send it. */
    upNext: PlayoutItem[];
    /** How many items are waiting in total, of which `upNext` is the head. */
    queuedCount: number;
}

/**
 * What the station is going to play, in order.
 *
 * Read-only. The running order is the API's, and nothing here can reach into it —
 * removing or reordering an item is a decision with a listener on the other end,
 * and there is no endpoint for it.
 *
 * The API caps what it sends (a playlist can be hundreds of tracks and this is
 * polled every couple of seconds) but reports the real total, so the shortfall is
 * stated rather than quietly presented as the whole order.
 */
export function TransportQueue({ upNext, queuedCount }: TransportQueueProps) {
    const hidden = Math.max(0, queuedCount - upNext.length);

    if (upNext.length === 0) {
        return (
            <Text size="sm" c="dimmed">
                Nothing queued behind this. When the running order drains, deadair stops driving and the station goes off air.
            </Text>
        );
    }

    return (
        <Stack gap={4}>
            <Text size="xs" tt="uppercase" c="dimmed" fw={600} style={{ letterSpacing: '0.08em' }}>
                Up next
            </Text>
            <ScrollArea.Autosize mah={140} type="hover">
                <Stack gap={2}>
                    {upNext.map((item, index) => (
                        <Group key={item.id} gap="xs" wrap="nowrap">
                            <Text size="xs" c="dimmed" ff="monospace" w={20} ta="right">
                                {index + 1}
                            </Text>
                            <Text size="sm" truncate style={{ flex: 1, minWidth: 0 }}>
                                {item.title}
                            </Text>
                            <Text size="sm" c="dimmed" truncate style={{ flex: 1, minWidth: 0 }}>
                                {item.artists.join(', ')}
                            </Text>
                            <Text size="xs" c="dimmed" ff="monospace">
                                {formatDuration(item.durationMs)}
                            </Text>
                        </Group>
                    ))}
                </Stack>
            </ScrollArea.Autosize>
            {hidden > 0 ? (
                <Text size="xs" c="dimmed">
                    +{hidden} more in the running order
                </Text>
            ) : undefined}
        </Stack>
    );
}
