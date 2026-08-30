import { Group, Pagination, Select, Text } from '@mantine/core';

import { PAGE_SIZES } from './catalog.page.params';

export interface CatalogPaginationProps {
    total: number;
    pageSize: number;
    /** Zero-based, matching the API. Mantine's pager is one-based, and the conversion happens here. */
    page: number;
    onChange: (page: number) => void;
    /** Absent leaves the size fixed, for a list whose route does not carry one. */
    onPageSizeChange?: (pageSize: number) => void;
}

const SIZE_OPTIONS = PAGE_SIZES.map(size => ({ value: String(size), label: `${size} rows` }));

/**
 * The pager under a catalog list, plus the count it is paging through and how much of it to show.
 *
 * A single page renders no PAGER: a pager with one page in it is a control that cannot do anything,
 * and the total is the part still worth saying. The size control is drawn either way, and that is
 * the difference between the two: on a one-page list it is the control that makes the list longer
 * or shorter, which is exactly when somebody reaches for it, so hiding it with the pager would take
 * it away in the case it is most useful.
 */
export function CatalogPagination({ total, pageSize, page, onChange, onPageSizeChange }: CatalogPaginationProps) {
    const pageCount = Math.ceil(total / pageSize);

    return (
        <Group justify="space-between">
            <Text size="sm" c="dimmed">
                {total === 1 ? '1 result' : `${total.toLocaleString()} results`}
            </Text>
            {/* Allowed to wrap: at phone width a pager past a handful of pages is wider than the
                row, and the size control dropping under it beats the page scrolling sideways. */}
            <Group gap="sm" justify="flex-end">
                {pageCount > 1 ? (
                    <Pagination
                        total={pageCount}
                        value={page + 1}
                        onChange={next => {
                            onChange(next - 1);
                        }}
                        size="sm"
                    />
                ) : undefined}
                {onPageSizeChange ? (
                    <Select
                        size="xs"
                        w={110}
                        aria-label="Rows per page"
                        data={SIZE_OPTIONS}
                        value={String(pageSize)}
                        allowDeselect={false}
                        onChange={next => {
                            if (next !== null) onPageSizeChange(Number(next));
                        }}
                    />
                ) : undefined}
            </Group>
        </Group>
    );
}
