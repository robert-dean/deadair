import { Anchor, Group, Stack, Table, Text } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';

import { catalogArtistsOptions, useRateArtist } from '../../api/catalog.queries';
import { Artwork } from '../shared/artwork';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { PageHeader } from '../shared/page.header';
import { PageSkeleton } from '../shared/page.skeleton';
import type { CatalogOrderParams } from './catalog.page.params';
import { CatalogPagination } from './catalog.pagination';
import { CatalogSearch } from './catalog.search';
import { RatingControl } from './rating.control';

export interface CatalogArtistsPageProps {
    page: number;
    search: string;
    /** How this list is ordered and how much of it is shown, carried in the URL. */
    order: CatalogOrderParams;
    onPageChange: (page: number) => void;
    onSearchChange: (search: string) => void;
}

export function CatalogArtistsPage({ page, search, order, onPageChange, onSearchChange }: CatalogArtistsPageProps) {
    const artists = useQuery(catalogArtistsOptions({ page, search, ...order }));
    const rows = artists.data?.data ?? [];
    const rate = useRateArtist();

    return (
        <Stack gap="lg">
            <PageHeader
                title="Catalog"
                description={
                    <Text c="dimmed" size="sm">
                        Every artist the station has ingested.
                    </Text>
                }
            />

            <Group justify="space-between" align="center">
                <CatalogSearch value={search} placeholder="Search artists" onChange={onSearchChange} />
                {/* The flat list is the only way to find a song whose artist the operator does not
                    already know, so it needs a way in that is not the address bar. */}
                <Anchor renderRoot={props => <Link to="/catalog/tracks" {...props} />} size="sm">
                    Browse all tracks
                </Anchor>
            </Group>

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
                    <Table highlightOnHover>
                        <Table.Thead>
                            <Table.Tr>
                                <Table.Th w={56} />
                                <Table.Th>Artist</Table.Th>
                                <Table.Th w={120}>Albums</Table.Th>
                                <Table.Th w={120}>Tracks</Table.Th>
                                <Table.Th w={150}>Rating</Table.Th>
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
                                            renderRoot={props => <Link to="/catalog/artists/$artistId" params={{ artistId: artist.id }} {...props} />}
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
                    <CatalogPagination total={artists.data.meta.total} pageSize={order.pageSize} page={page} onChange={onPageChange} />
                </>
            ) : undefined}
        </Stack>
    );
}
