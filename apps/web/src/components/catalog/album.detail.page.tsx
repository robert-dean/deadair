import { Alert, Anchor, Card, Skeleton, Stack, Table, Text, Title } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';

import { CATALOG_PAGE_SIZE, catalogAlbumOptions, catalogAlbumTracksOptions } from '../../api/catalog.queries';
import { apiErrorMessage } from '../../api/sdk.error';
import { formatDuration } from '../shared/format.duration';
import { CatalogPagination } from './catalog.pagination';

export interface AlbumDetailPageProps {
    albumId: string;
    page: number;
    onPageChange: (page: number) => void;
}

export function AlbumDetailPage({ albumId, page, onPageChange }: AlbumDetailPageProps) {
    const album = useQuery(catalogAlbumOptions(albumId));
    const tracks = useQuery(catalogAlbumTracksOptions(albumId, { page }));
    const rows = tracks.data?.data ?? [];

    return (
        <Stack gap="lg">
            <Stack gap={4}>
                {/* `renderRoot` rather than `component={Link}`: the polymorphic form erases the
                    router's own types, and with them the check that `params` matches the path. */}
                {album.data ? (
                    <Anchor renderRoot={props => <Link to="/catalog/artists/$artistId" params={{ artistId: album.data.artistId }} {...props} />} size="sm">
                        {`Back to ${album.data.artistName}`}
                    </Anchor>
                ) : (
                    <Anchor renderRoot={props => <Link to="/catalog" {...props} />} size="sm">
                        Back to catalog
                    </Anchor>
                )}
                <Title order={1}>{album.data?.name ?? 'Album'}</Title>
                {album.data ? (
                    <Text c="dimmed" size="sm">
                        {album.data.artistName}
                        {album.data.year === undefined ? '' : ` • ${album.data.year}`}
                    </Text>
                ) : undefined}
            </Stack>

            {album.error ? (
                <Alert color="red" title="This album could not be loaded">
                    {apiErrorMessage(album.error, 'No album with that id is in the catalog.')}
                </Alert>
            ) : undefined}

            {tracks.error && !album.error ? (
                <Alert color="red" title="The tracks could not be loaded">
                    {apiErrorMessage(tracks.error, 'The catalog is unavailable.')}
                </Alert>
            ) : undefined}

            {tracks.isPending && !album.error ? <Skeleton height={200} radius="sm" /> : undefined}

            {tracks.data && rows.length === 0 ? (
                <Card withBorder padding="xl" radius="sm">
                    <Text size="sm" c="dimmed">
                        This album has no tracks in the catalog.
                    </Text>
                </Card>
            ) : undefined}

            {tracks.data && rows.length > 0 ? (
                <>
                    <Table>
                        <Table.Thead>
                            <Table.Tr>
                                <Table.Th>Title</Table.Th>
                                <Table.Th>Credit</Table.Th>
                                <Table.Th w={120}>Duration</Table.Th>
                            </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                            {rows.map(track => (
                                <Table.Tr key={track.id}>
                                    <Table.Td>{track.title}</Table.Td>
                                    {/* The credit as written on the release, which is not the same
                                        as the canonical artist this album hangs off. */}
                                    <Table.Td>{track.artists}</Table.Td>
                                    <Table.Td>{formatDuration(track.durationMs)}</Table.Td>
                                </Table.Tr>
                            ))}
                        </Table.Tbody>
                    </Table>
                    <CatalogPagination total={tracks.data.meta.total} pageSize={CATALOG_PAGE_SIZE} page={page} onChange={onPageChange} />
                </>
            ) : undefined}
        </Stack>
    );
}
