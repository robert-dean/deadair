import { Fragment } from 'react';
import { Anchor, Group, Stack, Table, Text } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { catalogAlbumEnrichmentOptions, catalogAlbumOptions, catalogAlbumTracksOptions, useRateAlbum, useRateTrack } from '../../api/catalog.queries';
import { formatDuration } from '../shared/format.duration';
import { Artwork } from '../shared/artwork';
import { ArtistLink, TrackLink } from '../shared/catalog.links';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { PageHeader } from '../shared/page.header';
import { PageSkeleton } from '../shared/page.skeleton';
import { CATALOG_SEARCH_DEFAULTS, type TrackListOrder } from './catalog.page.params';
import { CatalogPagination } from './catalog.pagination';
import { EnrichmentPanel } from './enrichment.panel';
import { RatingControl } from './rating.control';
import { TrackEnrichmentRow, TrackExpandButton, useTrackExpansion } from './track.expansion';

export interface AlbumDetailPageProps {
    albumId: string;
    page: number;
    /** How the list on this page is ordered and how much of it is shown, carried in the URL. */
    order: TrackListOrder;
    onPageChange: (page: number) => void;
}

export function AlbumDetailPage({ albumId, page, order, onPageChange }: AlbumDetailPageProps) {
    const { t } = useTranslation('catalog');
    const album = useQuery(catalogAlbumOptions(albumId));
    const tracks = useQuery(catalogAlbumTracksOptions(albumId, { page, ...order }));
    const enrichment = useQuery(catalogAlbumEnrichmentOptions(albumId));
    const rows = tracks.data?.data ?? [];
    const expansion = useTrackExpansion();
    const rateAlbum = useRateAlbum();
    const rateTrack = useRateTrack();

    return (
        <Stack gap="lg">
            <Group align="flex-start" gap="md" wrap="nowrap">
                {album.data ? <Artwork src={album.data.imageUrl} alt={album.data.name} size={160} /> : undefined}
                <Stack gap="xxs">
                    {/* `renderRoot` rather than `component={Link}`: the polymorphic form erases the
                        router's own types, and with them the check that `params` matches the path. */}
                    {album.data ? (
                        <ArtistLink id={album.data.artistId} size="sm">
                            {t('album.backToArtist', { name: album.data.artistName })}
                        </ArtistLink>
                    ) : (
                        <Anchor renderRoot={(props: object) => <Link to="/catalog" search={CATALOG_SEARCH_DEFAULTS} {...props} />} size="sm">
                            {t('backToCatalog')}
                        </Anchor>
                    )}
                    <PageHeader
                        title={album.data?.name ?? t('album.fallbackTitle')}
                        description={
                            album.data ? (
                                <Text c="dimmed" size="sm">
                                    {album.data.artistName}
                                    {album.data.year === undefined ? '' : ` • ${album.data.year}`}
                                </Text>
                            ) : undefined
                        }
                    >
                        {/* An opinion about the RECORD, which is not an opinion about any one track on
                            it: a dislike here takes the whole thing out of rotation. */}
                        {album.data ? (
                            <Group gap="xs" pt="xxs">
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
                    </PageHeader>
                </Stack>
            </Group>

            {album.error ? <ErrorAlert title={t('album.loadFailedTitle')} error={album.error} fallback={t('album.loadFailedFallback')} /> : undefined}

            {tracks.error && !album.error ? (
                <ErrorAlert title={t('tracks.loadFailedTitle')} error={tracks.error} fallback={t('tracks.loadFailedFallback')} />
            ) : undefined}

            {/* Suppressed while the album itself is failing: one alert about a record that is not
                there is enough, and a second about its enrichment says nothing new. */}
            {album.error ? undefined : (
                <EnrichmentPanel
                    merged={enrichment.data?.merged}
                    sources={enrichment.data?.sources}
                    claims={enrichment.data?.claims}
                    isPending={enrichment.isPending}
                    error={enrichment.error}
                    emptyMessage={t('track.enrichmentEmpty')}
                />
            )}

            {tracks.isPending && !album.error ? <PageSkeleton variant="table" /> : undefined}

            {tracks.data && rows.length === 0 ? <EmptyState>{t('album.empty')}</EmptyState> : undefined}

            {tracks.data && rows.length > 0 ? (
                <>
                    <Table.ScrollContainer minWidth={650}>
                        <Table>
                            <Table.Thead>
                                <Table.Tr>
                                    <Table.Th w={44} />
                                    <Table.Th>{t('columns.title')}</Table.Th>
                                    <Table.Th>{t('album.credit')}</Table.Th>
                                    <Table.Th w={120}>{t('columns.duration')}</Table.Th>
                                    <Table.Th w={150}>{t('columns.rating')}</Table.Th>
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
                                            {/* Linked like the same record is in the flat tracks table:
                                            an operator reading a release is exactly as likely to
                                            want one track's own page from here. */}
                                            <Table.Td>
                                                <TrackLink id={track.id}>{track.title}</TrackLink>
                                            </Table.Td>
                                            {/* The credit as written on the release, which is not the same
                                            as the canonical artist this album hangs off. */}
                                            <Table.Td>{track.artists}</Table.Td>
                                            <Table.Td className="da-num">{formatDuration(track.durationMs)}</Table.Td>
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
                    </Table.ScrollContainer>
                    <CatalogPagination total={tracks.data.meta.total} pageSize={order.pageSize} page={page} onChange={onPageChange} />
                </>
            ) : undefined}
        </Stack>
    );
}
