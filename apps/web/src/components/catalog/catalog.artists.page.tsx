import { Anchor, Stack, Table, Text } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';

import { catalogArtistsOptions, useRateArtist } from '../../api/catalog.queries';
import { Artwork } from '../shared/artwork';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { PageHeader } from '../shared/page.header';
import { PageSkeleton } from '../shared/page.skeleton';
import { SortableTh } from '../shared/sortable.th';
import type { CatalogSort } from '@deadair/sdk';
import { CATALOG_ALBUM_DEFAULTS, type CatalogListOrder } from './catalog.page.params';
import { CatalogPagination } from './catalog.pagination';
import { CatalogSearch } from './catalog.search';
import { RatingControl } from './rating.control';

export interface CatalogArtistsPageProps {
    page: number;
    search: string;
    /** How this list is ordered and how much of it is shown, carried in the URL. */
    order: CatalogListOrder;
    onPageChange: (page: number) => void;
    onSearchChange: (search: string) => void;
    /** A new ordering, whole: changing any part of it is one gesture and resets the page. */
    onOrderChange: (order: CatalogListOrder) => void;
}

export function CatalogArtistsPage({ page, search, order, onPageChange, onSearchChange, onOrderChange }: CatalogArtistsPageProps) {
    const artists = useQuery(catalogArtistsOptions({ page, search, ...order }));
    const rows = artists.data?.data ?? [];
    const rate = useRateArtist();

    // Spread into every heading, so a column cannot be drawn active while sorting by another.
    const sorting = {
        active: order.sortBy,
        direction: order.sort,
        onSort: (sortBy: CatalogSort, sort: 'asc' | 'desc') => onOrderChange({ ...order, sortBy, sort }),
    };

    return (
        <Stack gap="lg">
            <PageHeader
                title="Artists"
                description={
                    <Text c="dimmed" size="sm">
                        Every artist the station has ingested.
                    </Text>
                }
            />

            {/* No "browse all tracks" link here: the Library's tab strip is the way to the flat
                list now, and a hand-written link beside the search duplicated it. */}
            <CatalogSearch value={search} placeholder="Search artists" onChange={onSearchChange} />

            {artists.error ? (
                <ErrorAlert title="The catalog could not be loaded" error={artists.error} fallback="The catalog is unavailable." />
            ) : undefined}

            {artists.isPending ? <PageSkeleton variant="table" /> : undefined}

            {artists.data && rows.length === 0 ? (
                <EmptyState title={search === '' ? 'The catalog is empty' : `Nothing matches “${search}”`}>
                    {search === ''
                        ? 'The catalog fills as enabled plugins are scanned. Nothing has been ingested yet.'
                        : 'Try a shorter term, or part of the name rather than all of it.'}
                </EmptyState>
            ) : undefined}

            {artists.data && rows.length > 0 ? (
                <>
                    <Table.ScrollContainer minWidth={600}>
                        <Table highlightOnHover>
                            <Table.Thead>
                                <Table.Tr>
                                    <Table.Th w={56} />
                                    <SortableTh sortBy="name" {...sorting}>
                                        Artist
                                    </SortableTh>
                                    <SortableTh sortBy="albums" w={120} {...sorting}>
                                        Albums
                                    </SortableTh>
                                    <SortableTh sortBy="tracks" w={120} {...sorting}>
                                        Tracks
                                    </SortableTh>
                                    <SortableTh sortBy="rating" w={150} {...sorting}>
                                        Rating
                                    </SortableTh>
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {rows.map(artist => (
                                    <Table.Tr key={artist.id}>
                                        <Table.Td>
                                            <Artwork src={artist.imageUrl} alt={artist.name} size={40} />
                                        </Table.Td>
                                        <Table.Td>
                                            {/* `renderRoot` rather than `component={Link}`: the polymorphic form erases
                                            the router's own types, and with them the check that `params` matches the path. */}
                                            <Anchor
                                                renderRoot={(props: object) => (
                                                    <Link
                                                        to="/catalog/artists/$artistId"
                                                        params={{ artistId: artist.id }}
                                                        search={CATALOG_ALBUM_DEFAULTS}
                                                        {...props}
                                                    />
                                                )}
                                            >
                                                {artist.name}
                                            </Anchor>
                                        </Table.Td>
                                        <Table.Td className="da-num">{artist.albumCount}</Table.Td>
                                        <Table.Td className="da-num">{artist.trackCount}</Table.Td>
                                        <Table.Td>
                                            {/* Rating from the list rather than only from the detail
                                            page: an operator forms most of these opinions while
                                            browsing, and a rating that costs a navigation each way
                                            is one they will not bother recording. */}
                                            <RatingControl
                                                size="xs"
                                                rating={artist.rating}
                                                label={artist.name}
                                                busy={rate.isPending && rate.variables?.id === artist.id}
                                                onChange={rating => {
                                                    rate.mutate({ id: artist.id, rating });
                                                }}
                                            />
                                        </Table.Td>
                                    </Table.Tr>
                                ))}
                            </Table.Tbody>
                        </Table>
                    </Table.ScrollContainer>
                    <CatalogPagination
                        total={artists.data.meta.total}
                        pageSize={order.pageSize}
                        page={page}
                        onChange={onPageChange}
                        onPageSizeChange={pageSize => onOrderChange({ ...order, pageSize })}
                    />
                </>
            ) : undefined}
        </Stack>
    );
}
