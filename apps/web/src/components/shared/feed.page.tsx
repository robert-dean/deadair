import type { ReactNode } from 'react';
import { Button, Group, Stack } from '@mantine/core';

import { DatedFeed, type DatedFeedItem } from './dated.feed';
import { EmptyState } from './empty.state';
import { ErrorAlert } from './error.alert';
import { PageSkeleton } from './page.skeleton';

/**
 * The part of an infinite query a feed shell reads, and nothing more.
 *
 * Deliberately narrower than TanStack's own result type. What a page shows is a function of exactly
 * these six answers, and a shell that reached for `isFetching` or `status` as well would start
 * drawing states the two pages never agreed to: a background refetch of the first page happens on a
 * timer here, and a spinner over a full feed every thirty seconds is not what either page means by
 * pending.
 */
export interface FeedQuery<TPage> {
    data?: { pages: TPage[] };
    isPending: boolean;
    isError: boolean;
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
    fetchNextPage: () => unknown;
}

export interface FeedPageProps<TPage, TItem extends DatedFeedItem> {
    query: FeedQuery<TPage>;
    /** How one page of the response becomes rows. The two feeds spell their array differently. */
    itemsFrom: (page: TPage) => TItem[];
    /** Why the feed could not be read, already resolved to a sentence. Absent means it could. */
    failure?: string;
    /**
     * What to say when there is nothing, already resolved.
     *
     * A string rather than a branch this component makes, because the branching is the part that is
     * genuinely per page: one feed tells an empty station from an empty filter, and the other tells
     * four cases apart including a break nothing has been asked to write yet. A shell that tried to
     * own that would be a shell with both pages' copy inside it.
     */
    emptyMessage: string;
    renderRow: (item: TItem) => ReactNode;
    /** The header, filters, and anything else above the feed. Rendered as given. */
    children?: ReactNode;
}

/**
 * The shell every feed in this console has: filters, then a failure, then rows, then more rows.
 *
 * Both feeds had this written out, and what actually drifts is not the markup but the ORDER and the
 * three-way state underneath it — pending, empty, and empty-because-filtered are decided by one
 * condition each and have to be decided the same way twice. That is what lives here.
 *
 * The query is passed IN rather than called here, and that is load-bearing rather than stylistic:
 * each page asks for its own filter with its own hook, so a shell that fetched would have to be told
 * which hook to call and would put the filter one indirection away from the page that owns it.
 *
 * It renders no links of its own. A feed's only links belong to its rows and to whatever the page
 * puts above it, so anything this added would appear in both pages at once, unasked.
 */
export function FeedPage<TPage, TItem extends DatedFeedItem>({
    query,
    itemsFrom,
    failure,
    emptyMessage,
    renderRow,
    children,
}: FeedPageProps<TPage, TItem>) {
    const items = query.data?.pages.flatMap(itemsFrom) ?? [];

    return (
        <Stack gap="lg">
            {children}

            {failure ? <ErrorAlert title="Nothing to show">{failure}</ErrorAlert> : undefined}

            {query.isPending ? <PageSkeleton variant="rows" count={3} /> : undefined}

            {/* All three conditions matter. Pending is not empty, and a feed that could not be read
                is not empty either: saying "nothing yet" over a failed request tells an operator the
                station did nothing, when what happened is that nobody managed to ask. */}
            {!query.isPending && items.length === 0 && failure === undefined ? <EmptyState>{emptyMessage}</EmptyState> : undefined}

            {items.length > 0 ? <DatedFeed items={items}>{renderRow}</DatedFeed> : undefined}

            {query.hasNextPage ? (
                <Group justify="center">
                    <Button variant="default" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
                        Load older
                    </Button>
                </Group>
            ) : undefined}
        </Stack>
    );
}
