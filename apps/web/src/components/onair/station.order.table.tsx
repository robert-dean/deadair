import { ActionIcon, Badge, Group, Table, Text, Tooltip } from '@mantine/core';
import type { Rating, StationItemState, StationOrderItem } from '@deadair/sdk';

import { RatingControl } from '../catalog/rating.control';
import { Artwork } from '../shared/artwork';
import { formatDuration } from '../shared/format.duration';

export interface StationOrderTableProps {
    items: StationOrderItem[];
    /** Offered on items nobody has been handed yet. Absent means this console cannot drop items at all. */
    onRemove?: (item: StationOrderItem) => void;
    /** Whether a removal is in flight, so the row can say so rather than looking ignored. */
    removingItemId?: string;
    /** Moving an item to a new index. Absent draws no handles. */
    onMove?: (item: StationOrderItem, toIndex: number) => void;
    /**
     * What the station thinks of the record on a row. Absent draws no rating controls at all.
     *
     * Offered on a SPENT row as well as a planned one, unlike every other control here: the record
     * that just finished is exactly the one an operator has an opinion about, and a rating is about
     * the work rather than about this item's turn in the order.
     */
    onRate?: (trackId: string, rating: Rating) => void;
    /** Which record's rating is being written, so its row can say so rather than looking ignored. */
    ratingTrackId?: string;
}

/** `artists.join(', ')`, but without a stray separator when the array is documented-empty. */
function formatArtists(artists: string[]): string {
    return artists.length > 0 ? artists.join(', ') : '';
}

/** Whether an item is beyond editing: the player has it, or it is behind us. */
const isSpent = (state: StationItemState): boolean => state !== 'planned';

/**
 * What decided a break's words, in a sentence.
 *
 * Free text on the row rather than a fixed set, because a station can install a writer this console
 * has never heard of. The two it does know are named; anything else is shown as it comes.
 */
function writerHint(writer: string): string {
    if (writer === 'model') return 'A model wrote these words.';
    if (writer === 'deterministic')
        return 'The station wrote these words itself, from its own phrasings. That is the floor: it is also what you hear when a model is off, missing, or too slow.';
    return `Written by ${writer}.`;
}

/**
 * How each state reads to somebody at the desk.
 *
 * The words matter more than they look. "Handed over" is deliberately not "playing": the pusher
 * runs a lead ahead of the listener by design, so an item the player is holding may be two records
 * from being heard, and a console that called it "playing" would be a track ahead of the stream.
 * That mistake is the one this whole shape exists to make unrepresentable.
 */
const STATE_LABEL: Record<StationItemState, { label: string; colour: string; hint: string } | undefined> = {
    planned: undefined,
    handed: {
        label: 'handed over',
        colour: 'gray',
        hint: 'The player is holding this one. It can no longer be moved or removed, and it has not aired yet.',
    },
    airing: { label: 'on air', colour: 'red', hint: 'The player says a listener is hearing this now.' },
    played: { label: 'played', colour: 'gray', hint: 'Heard, and behind us.' },
    skipped: {
        label: 'skipped',
        colour: 'yellow',
        hint: 'The station passed over this one: a segment with no audio, or an item the player never started.',
    },
    // Its own state rather than a shade of `skipped`, because it is the opposite fact: nothing
    // went wrong here. Grey rather than yellow for the same reason.
    removed: {
        label: 'removed',
        colour: 'gray',
        hint: 'You took this out. It stays in the order marked like this rather than disappearing, which is what stops the station planting another break into the same slot a minute later.',
    },
};

/**
 * The live running order, item by item, each saying where it has got to.
 *
 * Presentational: it owns no queries and decides nothing about what an edit means. The state is the
 * API's own answer to whether an item can still be acted on — anything but `planned` answers 422 to
 * every edit — so the controls follow it rather than a rule restated here.
 *
 * There is no cursor line to draw any more, and that is the point rather than a simplification: the
 * position used to be an integer that could disagree with what actually aired, and it is now a fact
 * on each item that the player itself reported.
 */
export function StationOrderTable({ items, onRemove, removingItemId, onMove, onRate, ratingTrackId }: StationOrderTableProps) {
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
                    {onRate ? <Table.Th w={130}>Rating</Table.Th> : undefined}
                    {editable ? <Table.Th w={60} /> : undefined}
                </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
                {items.map((item, index) => {
                    const state = STATE_LABEL[item.state];
                    // A segment is the station's own words, and a record the catalog has never seen
                    // has no row to hold an opinion — a station can air one it never ingested.
                    const trackId = item.kind === 'track' ? item.trackId : undefined;
                    return (
                        <Table.Tr
                            key={item.id}
                            // Dimmed rather than hidden: what is beyond editing is how an operator
                            // reads where the station has got to. The item ON AIR is not dimmed,
                            // because it is the one thing on the page that is happening.
                            opacity={item.state === 'airing' || item.state === 'planned' ? 1 : 0.5}
                        >
                            <Table.Td>
                                <Text size="xs" c="dimmed" ff="monospace">
                                    {index + 1}
                                </Text>
                            </Table.Td>
                            <Table.Td>
                                <Group gap="xs" wrap="nowrap">
                                    <Artwork src={item.artworkUrl} alt={item.title} size={28} radius="xs" />
                                    <Text size="sm" truncate fw={item.state === 'airing' ? 600 : undefined}>
                                        {item.title}
                                    </Text>
                                    {/* A segment is not a record and should not have to be worked
                                        out from an empty artist column. */}
                                    {item.kind === 'segment' ? (
                                        <Badge size="xs" variant="light" color="grape">
                                            segment
                                        </Badge>
                                    ) : undefined}
                                    {/* A talk-over never becomes something the player is handed: it
                                        is heard ALONGSIDE the record after it, with the music
                                        ducked under it. */}
                                    {item.overAtMs === undefined ? undefined : (
                                        <Badge size="xs" variant="light" color="grape">
                                            over the next record
                                        </Badge>
                                    )}
                                    {/* Which writer produced the words. Without it a model that
                                        degrades to the station's own phrasings on every single
                                        break looks exactly like a model that is working, and the
                                        answer has been on the row since it was written. */}
                                    {item.segmentWriter === undefined ? undefined : (
                                        <Tooltip label={writerHint(item.segmentWriter)} multiline maw={360}>
                                            <Badge size="xs" variant="light" color={item.segmentWriter === 'model' ? 'grape' : 'gray'}>
                                                {item.segmentWriter}
                                            </Badge>
                                        </Tooltip>
                                    )}
                                    {/* The station SKIPS a segment that has no audio when it comes
                                        round, rather than waiting for one. An operator reading the
                                        order has to be able to see which items will not be heard. */}
                                    {item.kind === 'segment' && item.playable === false && item.state === 'planned' ? (
                                        // The reason when the row carries one. A break that could
                                        // not be written and a DJ that simply talks less look
                                        // identical without it, and the difference is a sentence
                                        // already on the segment.
                                        <Tooltip
                                            multiline
                                            maw={360}
                                            label={item.segmentError ?? `This will be skipped: the segment is ${item.segmentState ?? 'unavailable'}`}
                                        >
                                            <Badge size="xs" variant="light" color="yellow">
                                                will skip
                                            </Badge>
                                        </Tooltip>
                                    ) : undefined}
                                    {state ? (
                                        <Tooltip label={state.hint} multiline maw={360}>
                                            <Text size="xs" c={state.colour} tt="uppercase" style={{ letterSpacing: '0.08em' }}>
                                                {state.label}
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
                            {onRate ? (
                                <Table.Td>
                                    {trackId === undefined ? undefined : (
                                        <RatingControl
                                            size="xs"
                                            rating={item.rating}
                                            label={item.title}
                                            busy={ratingTrackId === trackId}
                                            onChange={rating => {
                                                onRate(trackId, rating);
                                            }}
                                        />
                                    )}
                                </Table.Td>
                            ) : undefined}
                            {editable ? (
                                <Table.Td>
                                    {/* Nothing at all on a spent item, rather than a disabled
                                        control: the player is holding it or it is behind us, and an
                                        affordance that could only ever answer 422 is worse than no
                                        affordance. */}
                                    {onRemove && !isSpent(item.state) ? (
                                        <Tooltip label="Drop this item">
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
                    );
                })}
            </Table.Tbody>
        </Table>
    );
}
