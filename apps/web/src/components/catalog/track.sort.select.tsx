import { ActionIcon, Group, Select } from '@mantine/core';
import { IconSortAscending, IconSortDescending } from '@tabler/icons-react';
import type { TrackSort } from '@deadair/sdk';

import { TRACK_SORTS, type TrackListOrder } from './catalog.page.params';

export interface TrackSortSelectProps {
    order: TrackListOrder;
    /** A new ordering, whole, on the same terms as the headings: one gesture, and the page resets. */
    onOrderChange: (order: TrackListOrder) => void;
}

/** How each key reads as a menu entry rather than as a column heading. */
const SORT_LABEL: Record<TrackSort, string> = {
    title: 'Title',
    artist: 'Artist',
    album: 'Album',
    year: 'Year',
    duration: 'Duration',
    rating: 'Rating',
};

/**
 * The sort, where there are no column headings to click.
 *
 * The phone's card list drops the table, and with it the `SortableTh` row that carried the
 * ordering. This is the same fact as a control rather than a different fact: it writes through the
 * same `onOrderChange` into the same URL params, so a sort picked on a phone is still applied when
 * the same page is opened at a desk, and the other way round.
 *
 * The direction is its own button rather than six-times-two menu entries, because "the same column,
 * turned around" is one thought and twelve options is a list to re-read.
 */
export function TrackSortSelect({ order, onOrderChange }: TrackSortSelectProps) {
    return (
        <Group gap="xs" wrap="nowrap" align="flex-end">
            <Select
                size="xs"
                label="Sort by"
                style={{ flex: 1 }}
                data={TRACK_SORTS.map(sortBy => ({ value: sortBy, label: SORT_LABEL[sortBy] }))}
                value={order.sortBy}
                allowDeselect={false}
                onChange={next => {
                    // Arriving on a new key starts ascending, the same reading `SortableTh` gives a
                    // first click on a heading.
                    if (next !== null) onOrderChange({ ...order, sortBy: next as TrackSort, sort: 'asc' });
                }}
            />
            <ActionIcon
                variant="default"
                // 44 wide for a thumb, 30 tall to sit flush with the xs input beside it.
                w={44}
                h={30}
                aria-label={order.sort === 'asc' ? 'Ascending. Turn the sort around' : 'Descending. Turn the sort around'}
                onClick={() => onOrderChange({ ...order, sort: order.sort === 'asc' ? 'desc' : 'asc' })}
            >
                {order.sort === 'asc' ? <IconSortAscending size={16} stroke={1.8} /> : <IconSortDescending size={16} stroke={1.8} />}
            </ActionIcon>
        </Group>
    );
}
