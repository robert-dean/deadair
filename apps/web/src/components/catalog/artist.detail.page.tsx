import { Alert, Anchor, Card, Group, Skeleton, Stack, Table, Text, Title } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';

import { CATALOG_PAGE_SIZE, catalogArtistAlbumsOptions, catalogArtistOptions } from '../../api/catalog.queries';
import { apiErrorMessage } from '../../api/sdk.error';
import { Artwork } from './artwork';
import { CatalogPagination } from './catalog.pagination';

export interface ArtistDetailPageProps {
    artistId: string;
    page: number;
    onPageChange: (page: number) => void;
}

export function ArtistDetailPage({ artistId, page, onPageChange }: ArtistDetailPageProps) {
    const artist = useQuery(catalogArtistOptions(artistId));
    const albums = useQuery(catalogArtistAlbumsOptions(artistId, { page }));
    const rows = albums.data?.data ?? [];

    return (
        <Stack gap="lg">
            <Group align="flex-start" gap="md" wrap="nowrap">
                {/* Not rendered while the artist is loading: a placeholder initial for a name
                    nobody knows yet is a letter chosen at random. */}
                {artist.data ? <Artwork src={artist.data.imageUrl} alt={artist.data.name} size={120} /> : undefined}
                <Stack gap={4}>
                    {/* `renderRoot` rather than `component={Link}`: the polymorphic form erases the
                        router's own types, and with them the check that `params` matches the path. */}
                    <Anchor renderRoot={props => <Link to="/catalog" {...props} />} size="sm">
                        Back to catalog
                    </Anchor>
                    <Title order={1}>{artist.data?.name ?? 'Artist'}</Title>
                    {artist.data ? (
                        <Text c="dimmed" size="sm">
                            {artist.data.albumCount === 1 ? '1 album' : `${artist.data.albumCount} albums`}
                            {' • '}
                            {artist.data.trackCount === 1 ? '1 track' : `${artist.data.trackCount} tracks`}
                        </Text>
                    ) : undefined}
                </Stack>
            </Group>

            {artist.error ? (
                <Alert color="red" title="This artist could not be loaded">
                    {apiErrorMessage(artist.error, 'No artist with that id is in the catalog.')}
                </Alert>
            ) : undefined}

            {albums.error && !artist.error ? (
                <Alert color="red" title="The albums could not be loaded">
                    {apiErrorMessage(albums.error, 'The catalog is unavailable.')}
                </Alert>
            ) : undefined}

            {albums.isPending && !artist.error ? <Skeleton height={200} radius="sm" /> : undefined}

            {albums.data && rows.length === 0 ? (
                <Card withBorder padding="xl" radius="sm">
                    <Text size="sm" c="dimmed">
                        Nothing by this artist has been ingested as an album. Their tracks may still be in the catalog, filed without a release.
                    </Text>
                </Card>
            ) : undefined}

            {albums.data && rows.length > 0 ? (
                <>
                    <Table highlightOnHover>
                        <Table.Thead>
                            <Table.Tr>
                                <Table.Th w={56} />
                                <Table.Th>Album</Table.Th>
                                <Table.Th w={100}>Year</Table.Th>
                                <Table.Th w={120}>Tracks</Table.Th>
                            </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                            {rows.map(album => (
                                <Table.Tr key={album.id}>
                                    <Table.Td>
                                        <Artwork src={album.imageUrl} alt={album.name} size={40} />
                                    </Table.Td>
                                    <Table.Td>
                                        <Anchor
                                            renderRoot={props => <Link to="/catalog/albums/$albumId" params={{ albumId: album.id }} {...props} />}
                                        >
                                            {album.name}
                                        </Anchor>
                                    </Table.Td>
                                    <Table.Td>{album.year ?? ''}</Table.Td>
                                    <Table.Td>{album.trackCount}</Table.Td>
                                </Table.Tr>
                            ))}
                        </Table.Tbody>
                    </Table>
                    <CatalogPagination total={albums.data.meta.total} pageSize={CATALOG_PAGE_SIZE} page={page} onChange={onPageChange} />
                </>
            ) : undefined}
        </Stack>
    );
}
