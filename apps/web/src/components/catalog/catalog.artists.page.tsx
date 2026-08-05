import { Alert, Anchor, Card, Skeleton, Stack, Table, Text, Title } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';

import { CATALOG_PAGE_SIZE, catalogArtistsOptions } from '../../api/catalog.queries';
import { apiErrorMessage } from '../../api/sdk.error';
import { CatalogPagination } from './catalog.pagination';
import { CatalogSearch } from './catalog.search';

export interface CatalogArtistsPageProps {
    page: number;
    search: string;
    onPageChange: (page: number) => void;
    onSearchChange: (search: string) => void;
}

export function CatalogArtistsPage({ page, search, onPageChange, onSearchChange }: CatalogArtistsPageProps) {
    const artists = useQuery(catalogArtistsOptions({ page, search }));
    const rows = artists.data?.data ?? [];

    return (
        <Stack gap="lg">
            <Stack gap={4}>
                <Title order={1}>Catalog</Title>
                <Text c="dimmed" size="sm">
                    Every artist the station has ingested.
                </Text>
            </Stack>

            <CatalogSearch value={search} placeholder="Search artists" onChange={onSearchChange} />

            {artists.error ? (
                <Alert color="red" title="The catalog could not be loaded">
                    {apiErrorMessage(artists.error, 'The catalog is unavailable.')}
                </Alert>
            ) : undefined}

            {artists.isPending ? <Skeleton height={280} radius="sm" /> : undefined}

            {artists.data && rows.length === 0 ? (
                <Card withBorder padding="xl" radius="sm">
                    <Stack gap="xs">
                        <Text fw={600}>{search === '' ? 'The catalog is empty' : `Nothing matches “${search}”`}</Text>
                        <Text size="sm" c="dimmed" maw={520}>
                            {search === ''
                                ? 'The catalog fills as enabled plugins are scanned. Nothing has been ingested yet.'
                                : 'Try a shorter term, or part of the name rather than all of it.'}
                        </Text>
                    </Stack>
                </Card>
            ) : undefined}

            {artists.data && rows.length > 0 ? (
                <>
                    <Table highlightOnHover>
                        <Table.Thead>
                            <Table.Tr>
                                <Table.Th>Artist</Table.Th>
                                <Table.Th w={120}>Albums</Table.Th>
                                <Table.Th w={120}>Tracks</Table.Th>
                            </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                            {rows.map(artist => (
                                <Table.Tr key={artist.id}>
                                    <Table.Td>
                                        {/* `renderRoot` rather than `component={Link}`: the polymorphic form erases
                                            the router's own types, and with them the check that `params` matches the path. */}
                                        <Anchor renderRoot={props => <Link to="/catalog/artists/$artistId" params={{ artistId: artist.id }} {...props} />}>
                                            {artist.name}
                                        </Anchor>
                                    </Table.Td>
                                    <Table.Td>{artist.albumCount}</Table.Td>
                                    <Table.Td>{artist.trackCount}</Table.Td>
                                </Table.Tr>
                            ))}
                        </Table.Tbody>
                    </Table>
                    <CatalogPagination total={artists.data.meta.total} pageSize={CATALOG_PAGE_SIZE} page={page} onChange={onPageChange} />
                </>
            ) : undefined}
        </Stack>
    );
}
