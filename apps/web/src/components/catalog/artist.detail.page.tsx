import { Anchor, Group, Stack, Table, Text } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import {
    catalogArtistAlbumsOptions,
    catalogArtistEnrichmentOptions,
    catalogArtistOptions,
    useRateAlbum,
    useRateArtist,
} from '../../api/catalog.queries';
import { Artwork } from '../shared/artwork';
import { AlbumLink } from '../shared/catalog.links';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { PageHeader } from '../shared/page.header';
import { PageSkeleton } from '../shared/page.skeleton';
import { CATALOG_SEARCH_DEFAULTS, type CatalogListOrder } from './catalog.page.params';
import { CatalogPagination } from './catalog.pagination';
import { EnrichmentPanel } from './enrichment.panel';
import { RatingControl } from './rating.control';

export interface ArtistDetailPageProps {
    artistId: string;
    page: number;
    /** How the list on this page is ordered and how much of it is shown, carried in the URL. */
    order: CatalogListOrder;
    onPageChange: (page: number) => void;
}

export function ArtistDetailPage({ artistId, page, order, onPageChange }: ArtistDetailPageProps) {
    const { t } = useTranslation('catalog');
    const artist = useQuery(catalogArtistOptions(artistId));
    const albums = useQuery(catalogArtistAlbumsOptions(artistId, { page, ...order }));
    const enrichment = useQuery(catalogArtistEnrichmentOptions(artistId));
    const rows = albums.data?.data ?? [];
    const rateArtist = useRateArtist();
    const rateAlbum = useRateAlbum();

    return (
        <Stack gap="lg">
            <Group align="flex-start" gap="md" wrap="nowrap">
                {/* Not rendered while the artist is loading: a placeholder initial for a name
                    nobody knows yet is a letter chosen at random. */}
                {artist.data ? <Artwork src={artist.data.imageUrl} alt={artist.data.name} size={120} /> : undefined}
                <Stack gap="xxs">
                    {/* `renderRoot` rather than `component={Link}`: the polymorphic form erases the
                        router's own types, and with them the check that `params` matches the path. */}
                    <Anchor renderRoot={(props: object) => <Link to="/catalog" search={CATALOG_SEARCH_DEFAULTS} {...props} />} size="sm">
                        {t('backToCatalog')}
                    </Anchor>
                    <PageHeader
                        title={artist.data?.name ?? t('artist.fallbackTitle')}
                        description={
                            artist.data ? (
                                <Text c="dimmed" size="sm">
                                    {t('artist.albums', { count: artist.data.albumCount })}
                                    {' • '}
                                    {t('artist.tracks', { count: artist.data.trackCount })}
                                </Text>
                            ) : undefined
                        }
                    >
                        {/* The widest an opinion gets: a dislike here takes every record they are
                            credited on out of rotation, whatever the tracks themselves say. */}
                        {artist.data ? (
                            <Group gap="xs" pt="xxs">
                                <RatingControl
                                    size="xs"
                                    rating={artist.data.rating}
                                    label={artist.data.name}
                                    busy={rateArtist.isPending}
                                    onChange={rating => {
                                        rateArtist.mutate({ id: artistId, rating });
                                    }}
                                />
                            </Group>
                        ) : undefined}
                    </PageHeader>
                </Stack>
            </Group>

            {artist.error ? (
                <ErrorAlert title={t('artist.loadFailedTitle')} error={artist.error} fallback={t('artist.loadFailedFallback')} />
            ) : undefined}

            {albums.error && !artist.error ? (
                <ErrorAlert title={t('artist.albumsFailedTitle')} error={albums.error} fallback={t('tracks.loadFailedFallback')} />
            ) : undefined}

            {/* Suppressed while the artist itself is failing: one alert about an artist who is not
                there is enough, and a second about their enrichment says nothing new. */}
            {artist.error ? undefined : (
                <EnrichmentPanel
                    merged={enrichment.data?.merged}
                    sources={enrichment.data?.sources}
                    claims={enrichment.data?.claims}
                    isPending={enrichment.isPending}
                    error={enrichment.error}
                    emptyMessage={t('artist.enrichmentEmpty')}
                />
            )}

            {albums.isPending && !artist.error ? <PageSkeleton variant="table" /> : undefined}

            {albums.data && rows.length === 0 ? <EmptyState>{t('artist.empty')}</EmptyState> : undefined}

            {albums.data && rows.length > 0 ? (
                <>
                    <Table.ScrollContainer minWidth={600}>
                        <Table highlightOnHover>
                            <Table.Thead>
                                <Table.Tr>
                                    <Table.Th w={56} />
                                    <Table.Th>{t('columns.album')}</Table.Th>
                                    <Table.Th w={100}>{t('columns.year')}</Table.Th>
                                    <Table.Th w={120}>{t('columns.tracks')}</Table.Th>
                                    <Table.Th w={150}>{t('columns.rating')}</Table.Th>
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {rows.map(album => (
                                    <Table.Tr key={album.id}>
                                        <Table.Td>
                                            <Artwork src={album.imageUrl} alt={album.name} size={40} />
                                        </Table.Td>
                                        <Table.Td>
                                            <AlbumLink id={album.id}>{album.name}</AlbumLink>
                                        </Table.Td>
                                        <Table.Td className="da-num">{album.year ?? ''}</Table.Td>
                                        <Table.Td className="da-num">{album.trackCount}</Table.Td>
                                        <Table.Td>
                                            <RatingControl
                                                size="xs"
                                                rating={album.rating}
                                                label={album.name}
                                                busy={rateAlbum.isPending && rateAlbum.variables?.id === album.id}
                                                onChange={rating => {
                                                    rateAlbum.mutate({ id: album.id, rating });
                                                }}
                                            />
                                        </Table.Td>
                                    </Table.Tr>
                                ))}
                            </Table.Tbody>
                        </Table>
                    </Table.ScrollContainer>
                    <CatalogPagination total={albums.data.meta.total} pageSize={order.pageSize} page={page} onChange={onPageChange} />
                </>
            ) : undefined}
        </Stack>
    );
}
