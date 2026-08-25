import type { ReactNode } from 'react';
import { Group, Table, UnstyledButton } from '@mantine/core';
import { IconArrowDown, IconArrowUp } from '@tabler/icons-react';

export interface SortableThProps<TSort extends string> {
    /** The key this column sorts by, in the list's own vocabulary. */
    sortBy: TSort;
    /** What the list is ordered by right now, which may be some other column's key. */
    active: string;
    direction: 'asc' | 'desc';
    /**
     * Asked for a column and a direction together, because clicking one always decides both.
     *
     * Generic over the key so a heading hands back a member of its own list's vocabulary rather than
     * a bare string, which is what lets the page pass it on without a cast. The two lists here have
     * different vocabularies and share four of their words, so a string would type-check both ways
     * round and mean nothing.
     */
    onSort: (sortBy: TSort, direction: 'asc' | 'desc') => void;
    children: ReactNode;
    /** Passed through to the underlying `Table.Th`, since these are laid out in fixed columns. */
    w?: number;
}

/**
 * A column heading that orders the table by its own column.
 *
 * Two states rather than three. A third "unsorted" click would draw the same rows in the same order
 * as the list's default key, so it would be a state an operator cannot tell from the one before it;
 * what they can always do instead is click the column the list opens on.
 *
 * The arrow is drawn only on the ACTIVE column. An arrow on every heading is a table that looks
 * sorted six ways at once, and the question this answers is "what is this list ordered by", which
 * has one answer.
 *
 * The whole heading is the target rather than the arrow, because a heading is what somebody aims at,
 * and it is a real `button` inside the `th` rather than a click handler on the cell: that is what
 * makes it reachable by keyboard and announced as something that can be pressed. `aria-sort` carries
 * the state to a screen reader, where the arrow only carries it to an eye.
 */
export function SortableTh<TSort extends string>({ sortBy, active, direction, onSort, children, w }: SortableThProps<TSort>) {
    const sorted = active === sortBy;

    return (
        <Table.Th w={w} aria-sort={sorted ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
            <UnstyledButton
                // Turning a column around is what a second click means; arriving on a new column
                // starts ascending, which is the reading of "sort by this" nobody has to learn.
                onClick={() => onSort(sortBy, sorted && direction === 'asc' ? 'desc' : 'asc')}
                // The heading's own type and weight come from the `th`, so this only has to stop
                // being a browser button and start filling the cell.
                style={{ display: 'block', width: '100%', font: 'inherit', color: 'inherit' }}
            >
                <Group gap="xxs" wrap="nowrap">
                    {children}
                    {sorted ? (
                        direction === 'asc' ? (
                            <IconArrowUp size={13} stroke={2} aria-hidden />
                        ) : (
                            <IconArrowDown size={13} stroke={2} aria-hidden />
                        )
                    ) : undefined}
                </Group>
            </UnstyledButton>
        </Table.Th>
    );
}
