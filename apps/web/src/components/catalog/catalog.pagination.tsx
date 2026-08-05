import { Group, Pagination, Text } from '@mantine/core';

export interface CatalogPaginationProps {
    total: number;
    pageSize: number;
    /** Zero-based, matching the API. Mantine's pager is one-based, and the conversion happens here. */
    page: number;
    onChange: (page: number) => void;
}

/**
 * The pager under a catalog list, plus the count it is paging through.
 *
 * A single page renders the count alone: a pager with one page in it is a control that cannot do
 * anything, and the total is the part still worth saying.
 */
export function CatalogPagination({ total, pageSize, page, onChange }: CatalogPaginationProps) {
    const pageCount = Math.ceil(total / pageSize);

    return (
        <Group justify="space-between">
            <Text size="sm" c="dimmed">
                {total === 1 ? '1 result' : `${total.toLocaleString()} results`}
            </Text>
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
        </Group>
    );
}
