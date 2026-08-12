import { Fragment } from 'react';
import { Alert, Anchor, Card, Group, Skeleton, Stack, Table, Text, Title } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';

import {
    CATALOG_PAGE_SIZE,
    catalogAlbumEnrichmentOptions,
    catalogAlbumOptions,
    catalogAlbumTracksOptions,
    useRateAlbum,
    useRateTrack,
} from '../../api/catalog.queries';
import { apiErrorMessage } from '../../api/sdk.error';
import { formatDuration } from '../shared/format.duration';
import { Artwork } from '../shared/artwork';
import { CatalogPagination } from './catalog.pagination';
import { EnrichmentPanel } from './enrichment.panel';
import { RatingControl } from './rating.control';
import { TrackEnrichmentRow, TrackExpandButton, useTrackExpansion } from './track.expansion';

export interface AlbumDetailPageProps {
    albumId: string;
    page: number;
    onPageChange: (page: number) => void;
}

export function AlbumDetailPage({ albumId, page, onPageChange }: AlbumDetailPageProps) {
    const album = useQuery(catalogAlbumOptions(albumId));
    const tracks = useQuery(catalogAlbumTracksOptions(albumId, { page }));
    const enrichment = useQuery(catalogAlbumEnrichmentOptions(albumId));
    const rows = tracks.data?.data ?? [];
    const expansion = useTrackExpansion();
    const rateAlbum = useRateAlbum();
    const rateTrack = useRateTrack();

    return (
        <Stack gap="lg">
            <Group align="flex-start" gap="md" wrap="nowrap">
                {album.data ? <Artwork src={album.data.imageUrl} alt={album.data.name} size={160} /> : undefined}
                <Stack gap={4}>
                    {/* `renderRoot` rather than `component={Link}`: the polymorphic form erases the
                        router's own types, and with them the check that `params` matches the path. */}
                    {album.data ? (
                        <Anchor
                            renderRoot={props => <Link to="/catalog/artists/$artistId" params={{ artistId: album.data.artistId }} {...props} />}
                            size="sm"
                        >
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
                    {/* An opinion about the RECORD, which is not an opinion about any one track on
                        it: a dislike here takes the whole thing out of rotation. */}
                    {album.data ? (
                        <Group gap="xs" pt={4}>
                            <RatingControl
                                size="xs"
                                rating={album.data.rating}
                                label={album.data.name}
                                busy={rateAlbum.isPending}
                                onChange={rating => {
                                    rateAlbum.mutate({ id: albumId, rating });
                                }}
                            />
                        </Group>
                    ) : undefined}
                </Stack>
            </Group>

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

            {/* Suppressed while the album itself is failing: one alert about a record that is not
                there is enough, and a second about its enrichment says nothing new. */}
            {album.error ? undefined : (
                <EnrichmentPanel
                    merged={enrichment.data?.merged}
                    sources={enrichment.data?.sources}
                    isPending={enrichment.isPending}
                    error={enrichment.error}
                    emptyMessage="No provider has been asked about this record yet. The enrichment pass picks up what it has not seen, oldest first."
                />
            )}

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
                                <Table.Th w={44} />
                                <Table.Th>Title</Table.Th>
                                <Table.Th>Credit</Table.Th>
                                <Table.Th w={120}>Duration</Table.Th>
                                <Table.Th w={150}>Rating</Table.Th>
                            </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                            {rows.map(track => (
                                <Fragment key={track.id}>
                                    <Table.Tr>
                                        <Table.Td>
                                            <TrackExpandButton
                                                open={expansion.isOpen(track.id)}
                                                title={track.title}
                                                onToggle={() => {
                                                    expansion.toggle(track.id);
                                                }}
                                            />
                                        </Table.Td>
                                        <Table.Td>{track.title}</Table.Td>
                                        {/* The credit as written on the release, which is not the same
                                            as the canonical artist this album hangs off. */}
                                        <Table.Td>{track.artists}</Table.Td>
                                        <Table.Td>{formatDuration(track.durationMs)}</Table.Td>
                                        <Table.Td>
                                            <RatingControl
                                                size="xs"
                                                rating={track.rating}
                                                label={track.title}
                                                busy={rateTrack.isPending && rateTrack.variables?.id === track.id}
                                                onChange={rating => {
                                                    rateTrack.mutate({ id: track.id, rating });
                                                }}
                                            />
                                        </Table.Td>
                                    </Table.Tr>
                                    {/* One wider than the row above it, so the expansion still spans
                                        the table now that the rating has its own column. */}
                                    <TrackEnrichmentRow trackId={track.id} open={expansion.isOpen(track.id)} colSpan={5} />
                                </Fragment>
                            ))}
                        </Table.Tbody>
                    </Table>
                    <CatalogPagination total={tracks.data.meta.total} pageSize={CATALOG_PAGE_SIZE} page={page} onChange={onPageChange} />
                </>
            ) : undefined}
        </Stack>
    );
}
