import { Skeleton, Stack } from '@mantine/core';

/**
 * The three shapes anything in this console is loading into.
 *
 * `rows` is a list of lines, `table` is a block where a table will be, `card` is one panel among
 * others in a grid. There were twelve of these at six different heights, which is a flicker every
 * time a page resolved: the placeholder was never the size of the thing that replaced it, so the
 * layout jumped. Fixing the sizes here is the only way that stays fixed.
 */
export type SkeletonVariant = 'rows' | 'table' | 'card';

const HEIGHTS: Record<SkeletonVariant, number> = {
    rows: 28,
    table: 260,
    card: 196,
};

export interface PageSkeletonProps {
    variant: SkeletonVariant;
    /** Only meaningful for `rows`; the other two are one block each. */
    count?: number;
}

export function PageSkeleton({ variant, count = 3 }: PageSkeletonProps) {
    if (variant !== 'rows') return <Skeleton height={HEIGHTS[variant]} />;

    return (
        <Stack gap="xs">
            {Array.from({ length: count }, (_, index) => (
                <Skeleton key={index} height={HEIGHTS.rows} />
            ))}
        </Stack>
    );
}
