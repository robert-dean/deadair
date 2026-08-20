import { Group, ScrollArea, Stack, Text } from '@mantine/core';
import type { PlayoutItem } from '@deadair/sdk';

import { Artwork } from '../shared/artwork';
import { TrackLink } from '../shared/catalog.links';
import { Eyebrow } from '../shared/eyebrow';
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
        <Stack gap="xxs">
            <Eyebrow>Up next</Eyebrow>
            <ScrollArea.Autosize mah={140} type="hover">
                <Stack gap="xxxs">
                    {upNext.map((item, index) => (
                        <Group key={item.id} gap="xs" wrap="nowrap">
                            <Text size="xs" c="dimmed" ff="monospace" w={20} ta="right">
                                {index + 1}
                            </Text>
                            <Artwork src={item.artworkUrl} alt={item.title} size={24} radius="xs" />
                            {/* Read-only about the ORDER and still a way into the catalog: nothing
                                here can move or drop an item, but a title an operator is squinting
                                at should reach the record it names. */}
                            <TrackLink id={item.trackId} size="sm" truncate style={{ flex: 1, minWidth: 0 }}>
                                {item.title}
                            </TrackLink>
                            <Text size="sm" c="dimmed" truncate style={{ flex: 1, minWidth: 0 }}>
                                {item.artists.join(', ')}
                            </Text>
                            <Text size="xs" c="dimmed" className="da-num">
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
