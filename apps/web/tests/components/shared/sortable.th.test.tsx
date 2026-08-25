// The console's one sortable column heading. What matters here is what a click ASKS FOR, since the
// list itself is server-ordered: a heading that asked for the wrong direction would draw a
// plausible page in the wrong order, which is the failure a table cannot show.

import { describe, expect, it, vi } from 'vitest';
import { Table } from '@mantine/core';

import { SortableTh } from '../../../src/components/shared/sortable.th';
import { render, screen, setupUser } from '../../utils/render';

/** A `th` outside a table is invalid markup, and Mantine's own components assert on the context. */
const inTable = (heading: React.ReactNode) => (
    <Table>
        <Table.Thead>
            <Table.Tr>{heading}</Table.Tr>
        </Table.Thead>
    </Table>
);

describe('SortableTh', () => {
    it('asks for its own column ascending when the list is ordered by something else', async () => {
        const onSort = vi.fn();
        const user = setupUser();
        render(
            inTable(
                <SortableTh sortBy="albums" active="name" direction="asc" onSort={onSort}>
                    Albums
                </SortableTh>,
            ),
        );

        await user.click(screen.getByRole('button', { name: 'Albums' }));

        expect(onSort).toHaveBeenCalledWith('albums', 'asc');
    });

    /** The second click on the column you are already on is the one that means "the other way". */
    it('turns its own column around rather than asking for the same order twice', async () => {
        const onSort = vi.fn();
        const user = setupUser();
        render(
            inTable(
                <SortableTh sortBy="albums" active="albums" direction="asc" onSort={onSort}>
                    Albums
                </SortableTh>,
            ),
        );

        await user.click(screen.getByRole('button', { name: 'Albums' }));

        expect(onSort).toHaveBeenCalledWith('albums', 'desc');
    });

    it('comes back ascending from descending, so two states is all there is', async () => {
        const onSort = vi.fn();
        const user = setupUser();
        render(
            inTable(
                <SortableTh sortBy="albums" active="albums" direction="desc" onSort={onSort}>
                    Albums
                </SortableTh>,
            ),
        );

        await user.click(screen.getByRole('button', { name: 'Albums' }));

        expect(onSort).toHaveBeenCalledWith('albums', 'asc');
    });

    /**
     * `aria-sort` is the only place the state exists for somebody not looking at the arrow, and the
     * inactive columns have to say `none` rather than nothing: a table where every heading claims an
     * ordering is a table that is sorted six ways at once.
     */
    it('says which way it is sorted, and only on the column that is', () => {
        const { container } = render(
            inTable(
                <>
                    <SortableTh sortBy="name" active="albums" direction="desc" onSort={vi.fn()}>
                        Artist
                    </SortableTh>
                    <SortableTh sortBy="albums" active="albums" direction="desc" onSort={vi.fn()}>
                        Albums
                    </SortableTh>
                </>,
            ),
        );

        const headings = [...container.querySelectorAll('th')];
        expect(headings.map(heading => heading.getAttribute('aria-sort'))).toEqual(['none', 'descending']);
    });

    it('reads ascending as ascending, since the two are opposite claims', () => {
        const { container } = render(
            inTable(
                <SortableTh sortBy="albums" active="albums" direction="asc" onSort={vi.fn()}>
                    Albums
                </SortableTh>,
            ),
        );

        expect(container.querySelector('th')?.getAttribute('aria-sort')).toBe('ascending');
    });

    /** A heading is what somebody aims at, and it has to be reachable without a mouse. */
    it('is a real button, so it is reachable by keyboard', () => {
        render(
            inTable(
                <SortableTh sortBy="albums" active="name" direction="asc" onSort={vi.fn()}>
                    Albums
                </SortableTh>,
            ),
        );

        expect(screen.getByRole('button', { name: 'Albums' })).toBeInTheDocument();
    });
});
