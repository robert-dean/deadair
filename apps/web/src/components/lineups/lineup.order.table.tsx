import { ActionIcon, Badge, Group, Table, Text, Tooltip } from '@mantine/core';
import type { LineupItem } from '@deadair/sdk';

import { Artwork } from '../shared/artwork';
import { formatDuration } from '../shared/format.duration';

export interface LineupOrderTableProps {
    items: LineupItem[];
    /** How far the current broadcast has committed. Everything before it is in the player's hands. */
    cursor: number;
    /** Offered on uncommitted lines only. Absent means this console cannot drop lines at all. */
    onRemove?: (item: LineupItem) => void;
    /** Whether a removal is in flight, so the row can say so rather than looking ignored. */
    removingItemId?: string;
    /**
     * Moving a line to a new index.
     *
     * Not supplied yet: the console draws the order but does not offer to reorder it. The prop is
     * the seam — the table renders the handle column only when a caller can act on it, so adding
     * the interaction is a handler here rather than a rewrite of the table.
     */
    onMove?: (item: LineupItem, toIndex: number) => void;
}

/** `artists.join(', ')`, but without a stray separator when the array is documented-empty. */
function formatArtists(artists: string[]): string {
    return artists.length > 0 ? artists.join(', ') : '';
}

/**
 * A lineup's order, with the line the broadcast has already committed to drawn across it.
 *
 * Presentational: it owns no queries and decides nothing about what an edit means. `committed` is
 * the API's own answer to whether a line can still be acted on — a line already handed to the
 * player answers 422 to every edit — so the controls follow it rather than a rule restated here.
 */
export function LineupOrderTable({ items, cursor, onRemove, removingItemId, onMove }: LineupOrderTableProps) {
    const editable = onRemove !== undefined || onMove !== undefined;

    return (
        <Table highlightOnHover verticalSpacing="xs">
            <Table.Thead>
                <Table.Tr>
                    <Table.Th w={40}>#</Table.Th>
                    <Table.Th>Title</Table.Th>
                    <Table.Th>Artists</Table.Th>
                    <Table.Th visibleFrom="sm">Album</Table.Th>
                    <Table.Th w={90}>Duration</Table.Th>
                    {editable ? <Table.Th w={60} /> : undefined}
                </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
                {items.map((item, index) => (
                    <Table.Tr
                        key={item.id}
                        // Dimmed rather than hidden: what is beyond editing is how an operator reads
                        // where the station is in the plan.
                        opacity={item.committed ? 0.5 : 1}
                        style={
                            // The cursor is a line, so it is drawn as one. The first uncommitted
                            // row is where every edit this console offers begins.
                            index === cursor && cursor > 0 ? { borderTop: '2px solid var(--mantine-color-red-6)' } : undefined
                        }
                    >
                        <Table.Td>
                            <Text size="xs" c="dimmed" ff="monospace">
                                {index + 1}
                            </Text>
                        </Table.Td>
                        <Table.Td>
                            <Group gap="xs" wrap="nowrap">
                                <Artwork src={item.artworkUrl} alt={item.title} size={28} radius="xs" />
                                <Text size="sm" truncate>
                                    {item.title}
                                </Text>
                                {/* A segment is not a record and should not have to be worked out
                                    from an empty artist column. */}
                                {item.kind === 'segment' ? (
                                    <Badge size="xs" variant="light" color="grape">
                                        segment
                                    </Badge>
                                ) : undefined}
                                {/* The station SKIPS a segment that has no audio when the cursor
                                    reaches it, rather than waiting for one. An operator reading the
                                    order has to be able to see which lines will not be heard. */}
                                {item.kind === 'segment' && !item.playable ? (
                                    // The reason when the row carries one. A break that could not be
                                    // written and a DJ that simply talks less look identical without
                                    // it, and the difference is a sentence already on the segment.
                                    <Tooltip
                                        multiline
                                        maw={360}
                                        label={
                                            item.segmentError ??
                                            `This will be skipped: the segment is ${item.segmentState ?? 'unavailable'}`
                                        }
                                    >
                                        <Badge size="xs" variant="light" color="yellow">
                                            will skip
                                        </Badge>
                                    </Tooltip>
                                ) : undefined}
                                {/* NOT "aired". The cursor is the COMMIT cursor: the director keeps a
                                    few lines committed ahead of what is playing, so the newest locked
                                    lines are the ones the transport is still calling "up next". Saying
                                    "aired" against a track nobody has heard yet is the console
                                    contradicting itself on the same screen. */}
                                {item.committed ? (
                                    <Tooltip label="The player is holding this one. It can no longer be moved or removed, and it may not have aired yet.">
                                        <Text size="xs" c="dimmed" tt="uppercase" style={{ letterSpacing: '0.08em' }}>
                                            locked
                                        </Text>
                                    </Tooltip>
                                ) : undefined}
                            </Group>
                        </Table.Td>
                        <Table.Td>
                            <Text size="sm" c="dimmed" truncate>
                                {formatArtists(item.artists)}
                            </Text>
                        </Table.Td>
                        <Table.Td visibleFrom="sm">
                            <Text size="sm" c="dimmed" truncate>
                                {item.album ?? ''}
                                {item.year ? ` (${item.year})` : ''}
                            </Text>
                        </Table.Td>
                        <Table.Td>
                            <Text size="xs" c="dimmed" ff="monospace">
                                {formatDuration(item.durationMs)}
                            </Text>
                        </Table.Td>
                        {editable ? (
                            <Table.Td>
                                {/* Nothing at all on a committed line, rather than a disabled
                                    control: the player is holding it, and an affordance that
                                    could only ever answer 422 is worse than no affordance. */}
                                {onRemove && !item.committed ? (
                                    <Tooltip label="Drop this line">
                                        <ActionIcon
                                            variant="subtle"
                                            color="red"
                                            aria-label={`Drop ${item.title}`}
                                            loading={removingItemId === item.id}
                                            onClick={() => onRemove(item)}
                                        >
                                            ✕
                                        </ActionIcon>
                                    </Tooltip>
                                ) : undefined}
                            </Table.Td>
                        ) : undefined}
                    </Table.Tr>
                ))}
            </Table.Tbody>
        </Table>
    );
}
