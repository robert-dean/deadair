import { Fragment } from 'react';
import { Badge, Group, Stack, Table, Text, Tooltip } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { catalogTracksOptions, useRateTrack } from '../../api/catalog.queries';
import { formatDuration } from '../shared/format.duration';
import { Artwork } from '../shared/artwork';
import { AlbumLink, ArtistLink, TrackLink } from '../shared/catalog.links';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { PageHeader } from '../shared/page.header';
import { PageSkeleton } from '../shared/page.skeleton';
import { PhoneCard } from '../shared/phone.card';
import { SortableTh } from '../shared/sortable.th';
import { usePhone } from '../shared/use.phone';
import { CatalogPagination } from './catalog.pagination';
import type { TrackSort } from '@deadair/sdk';
import type { TrackListOrder, TrackStateParam } from './catalog.page.params';
import { CatalogSearch } from './catalog.search';
import { RatingControl } from './rating.control';
import { TrackSortSelect } from './track.sort.select';
import { TrackStateAction } from './track.state.action';
import { TrackStateFilter } from './track.state.filter';
import { TrackEnrichmentCollapse, TrackEnrichmentRow, TrackExpandButton, useTrackExpansion } from './track.expansion';

export interface CatalogTracksPageProps {
    page: number;
    search: string;
    state: TrackStateParam | '';
    /** How this list is ordered and how much of it is shown, carried in the URL. */
    order: TrackListOrder;
    onPageChange: (page: number) => void;
    onSearchChange: (search: string) => void;
    onStateChange: (state: TrackStateParam | '') => void;
    /** A new ordering, whole: changing any part of it is one gesture and resets the page. */
    onOrderChange: (order: TrackListOrder) => void;
}

// How each state reads when nothing is in it, in the operator's terms rather than the column's, is
// `tracks.nothingInState.<state>` in the catalog namespace.

/**
 * Why a list has nothing in it, which is three different facts.
 *
 * Only one of them is a problem. A station with no records at all is its first hour; a search that
 * matches nothing is a typo; and a fault filter that matches nothing is the answer an operator was
 * hoping for. Reading "the catalog is empty" over a library of eight hundred records was the third
 * case wearing the first one's words.
 *
 * The search is asked FIRST and that ordering is load-bearing: `total` is the counts' own total, and
 * the counts honour the search — so a term nothing matches answers zero over a full library and
 * would otherwise read as an empty catalog. They deliberately do not honour the STATE, which is why
 * `total` is trustworthy as the library's size by the time the state is asked about.
 */
function NothingHere({ search, state, total }: { search: string; state: TrackStateParam | ''; total: number }) {
    const { t } = useTranslation('catalog');
    if (search !== '') {
        return <EmptyState title={t('tracks.noMatch.title', { search })}>{t('tracks.noMatch.body')}</EmptyState>;
    }

    if (total === 0) {
        return <EmptyState title={t('tracks.empty.title')}>{t('tracks.empty.body')}</EmptyState>;
    }

    if (state !== '') return <EmptyState title={t('tracks.nothingInState.title')}>{t(`tracks.nothingInState.${state}`)}</EmptyState>;

    // Unreachable in practice: an unfiltered list of a non-empty catalog has rows. Answered rather
    // than left blank, because a page drawing nothing at all reads as broken.
    return <EmptyState title={t('tracks.nothingToShow.title')}>{t('tracks.nothingToShow.body')}</EmptyState>;
}

/**
 * One of the three facts a row carries about what the station has of a track.
 *
 * Drawn only when it is true, as a word rather than a letter: a fixed "A M E" needed a hover on
 * each letter to mean anything, and a dimmed one was the only signal that something was missing.
 * The absence of a badge already says "not yet" without a placeholder to parse. The tooltip still
 * carries the full sentence.
 */
function StateMark({ on, kind }: { on: boolean; kind: 'audio' | 'measured' | 'described' }) {
    const { t } = useTranslation('catalog');
    if (!on) return null;

    return (
        <Tooltip label={t(`tracks.stateMark.${kind}.tooltip`)}>
            <Badge size="xs" variant="light" aria-label={t(`tracks.stateMark.${kind}.label`)}>
                {t(`tracks.stateMark.${kind}.text`)}
            </Badge>
        </Tooltip>
    );
}

/**
 * Every track, flat.
 *
 * The drill-down cannot answer "do we have this song?" without already knowing whose it is, which
 * is the question the operator actually arrives with.
 */
export function CatalogTracksPage({
    page,
    search,
    state,
    order,
    onPageChange,
    onSearchChange,
    onStateChange,
    onOrderChange,
}: CatalogTracksPageProps) {
    const { t } = useTranslation('catalog');
    const tracks = useQuery(catalogTracksOptions({ page, search, state, ...order }));
    const rows = tracks.data?.data ?? [];
    const expansion = useTrackExpansion();
    const rate = useRateTrack();
    const phone = usePhone();

    // Spread into every heading, so a column cannot be drawn active while sorting by another.
    const sorting = {
        active: order.sortBy,
        direction: order.sort,
        onSort: (sortBy: TrackSort, sort: 'asc' | 'desc') => onOrderChange({ ...order, sortBy, sort }),
    };

    return (
        <Stack gap="lg">
            {/* No "back to catalog" link here: the Library's tab strip is the navigation between
                Tracks and Artists, and a hand-written link beside it duplicated the strip under
                the wrong name — `/catalog` is the Artists tab, not "catalog". */}
            <PageHeader
                title={t('tracks.title')}
                description={
                    <Text c="dimmed" size="sm">
                        {t('tracks.description')}
                    </Text>
                }
            />

            <CatalogSearch value={search} placeholder={t('tracks.search')} onChange={onSearchChange} />

            {/* Under the search rather than over it: the counts describe whatever the search has
                narrowed to, and reading them above the box they answer to would be backwards. */}
            <TrackStateFilter counts={tracks.data?.states} value={state} onChange={onStateChange} />

            {/* Under the filter and above the table, because it acts on what the filter chose and on
                the rows drawn below it. Draws nothing outside the two fault states: most of a
                library is `uncached`, and a bulk verb over that is a re-fetch of everything. */}
            <TrackStateAction state={state} trackIds={rows.map(track => track.id)} />

            {tracks.error ? (
                <ErrorAlert title={t('tracks.loadFailedTitle')} error={tracks.error} fallback={t('tracks.loadFailedFallback')} />
            ) : undefined}

            {tracks.isPending ? <PageSkeleton variant="table" /> : undefined}

            {/* Three empty lists rather than two, because they are three different facts and only one
                of them is a problem. An install with nothing ingested is the first hour of a station;
                a search that matches nothing is a typo; and a state filter that matches nothing is
                GOOD NEWS — nothing is benched — which reading "the catalog is empty" over a library
                of eight hundred records was actively lying about. It became worth telling apart when
                the desk started linking straight to a filtered list: the row an operator has just
                emptied lands them here. */}
            {tracks.data && rows.length === 0 ? <NothingHere search={search} state={state} total={tracks.data.states.total} /> : undefined}

            {/* The phone gets cards rather than a table that scrolls sideways, on the desk's own
                argument: what survives 375px is a different selection, and the album is the
                dropped column. The sort — a column heading's job everywhere else — becomes a
                control, writing through the same URL params so it survives the breakpoint. Chosen
                with the media query rather than `hiddenFrom`, because a hundred rows each carrying
                artwork, links and a rating control is a real cost to render twice. */}
            {phone && tracks.data && rows.length > 0 ? (
                <>
                    <TrackSortSelect order={order} onOrderChange={onOrderChange} />
                    <Stack gap="xxs">
                        {rows.map(track => (
                            <PhoneCard
                                key={track.id}
                                leading={<Artwork src={track.albumImageUrl} alt={track.albumName ?? track.title} size={36} />}
                                title={
                                    <TrackLink id={track.id} size="sm" truncate>
                                        {track.title}
                                    </TrackLink>
                                }
                                subtitle={
                                    <ArtistLink id={track.artistId} size="xs" c="dimmed" truncate>
                                        {track.artistName}
                                    </ArtistLink>
                                }
                                figure={
                                    <Text size="xs" c="dimmed" className="da-num">
                                        {formatDuration(track.durationMs)}
                                    </Text>
                                }
                                action={
                                    <TrackExpandButton
                                        size={44}
                                        open={expansion.isOpen(track.id)}
                                        title={track.title}
                                        onToggle={() => {
                                            expansion.toggle(track.id);
                                        }}
                                    />
                                }
                                below={
                                    <Stack gap="xxs" pt="xxs">
                                        {/* Below the title rather than beside it: three badges spelled out in
                                        words don't fit next to a truncating title on a 375px card the way
                                        three letters did. Only rendered when there is at least one to show,
                                        so a fresh, empty-of-facts row doesn't reserve a blank line for it. */}
                                        {track.hasAudio || track.measured || track.enriched ? (
                                            <Group gap="xxs" wrap="wrap">
                                                <StateMark on={track.hasAudio} kind="audio" />
                                                <StateMark on={track.measured} kind="measured" />
                                                <StateMark on={track.enriched} kind="described" />
                                            </Group>
                                        ) : undefined}
                                        <RatingControl
                                            size="xs"
                                            rating={track.rating}
                                            label={track.title}
                                            busy={rate.isPending && rate.variables?.id === track.id}
                                            onChange={rating => {
                                                rate.mutate({ id: track.id, rating });
                                            }}
                                        />
                                        <TrackEnrichmentCollapse trackId={track.id} open={expansion.isOpen(track.id)} />
                                    </Stack>
                                }
                            />
                        ))}
                    </Stack>
                    <CatalogPagination
                        total={tracks.data.meta.total}
                        pageSize={order.pageSize}
                        page={page}
                        onChange={onPageChange}
                        onPageSizeChange={pageSize => onOrderChange({ ...order, pageSize })}
                    />
                </>
            ) : undefined}

            {!phone && tracks.data && rows.length > 0 ? (
                <>
                    <Table.ScrollContainer minWidth={800}>
                        <Table highlightOnHover>
                            <Table.Thead>
                                <Table.Tr>
                                    <Table.Th w={52} />
                                    <Table.Th w={44} />
                                    <SortableTh sortBy="title" {...sorting}>
                                        {t('columns.title')}
                                    </SortableTh>
                                    <SortableTh sortBy="artist" {...sorting}>
                                        {t('columns.artist')}
                                    </SortableTh>
                                    <SortableTh sortBy="album" {...sorting}>
                                        {t('columns.album')}
                                    </SortableTh>
                                    <SortableTh sortBy="duration" w={120} {...sorting}>
                                        {t('columns.duration')}
                                    </SortableTh>
                                    {/* Not sortable, and the contract says why: a state is three
                                    independent booleans, so there is no order of it an operator
                                    would agree with. Wide enough for up to three badges, since only
                                    the facts that are true are drawn. */}
                                    <Table.Th w={220}>{t('columns.state')}</Table.Th>
                                    <SortableTh sortBy="rating" w={150} {...sorting}>
                                        {t('columns.rating')}
                                    </SortableTh>
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {rows.map(track => (
                                    <Fragment key={track.id}>
                                        <Table.Tr>
                                            {/* The record's cover, since nothing hangs art off a recording. Blank for a
                                        single ingested outside any release, which has no record to borrow from. */}
                                            <Table.Td>
                                                <Artwork src={track.albumImageUrl} alt={track.albumName ?? track.title} size={36} />
                                            </Table.Td>
                                            <Table.Td>
                                                <TrackExpandButton
                                                    open={expansion.isOpen(track.id)}
                                                    title={track.title}
                                                    onToggle={() => {
                                                        expansion.toggle(track.id);
                                                    }}
                                                />
                                            </Table.Td>
                                            <Table.Td>
                                                {/* Drawn like the artist and album links beside it rather
                                                than as plain text: the title is now the way into
                                                everything a record has accumulated, and a link
                                                nobody can see is a page nobody finds. */}
                                                <TrackLink id={track.id}>{track.title}</TrackLink>
                                            </Table.Td>
                                            <Table.Td>
                                                <ArtistLink id={track.artistId}>{track.artistName}</ArtistLink>
                                            </Table.Td>
                                            {/* A track ingested outside any release has no album, which is a
                                        blank cell rather than a broken link — which is what an absent
                                        id already means to `AlbumLink`. */}
                                            <Table.Td>
                                                <AlbumLink id={track.albumId}>{track.albumName ?? ''}</AlbumLink>
                                            </Table.Td>
                                            <Table.Td className="da-num">{formatDuration(track.durationMs)}</Table.Td>
                                            {/* Three facts, as badges rather than three columns: what a row
                                            can afford is a glance, and anything more detailed is the
                                            record's own page one click away. Only the ones that are true
                                            draw at all — an absent badge already reads as "not yet". */}
                                            <Table.Td>
                                                <Group gap="xxs" wrap="wrap">
                                                    <StateMark on={track.hasAudio} kind="audio" />
                                                    <StateMark on={track.measured} kind="measured" />
                                                    <StateMark on={track.enriched} kind="described" />
                                                </Group>
                                            </Table.Td>
                                            <Table.Td>
                                                <RatingControl
                                                    size="xs"
                                                    rating={track.rating}
                                                    label={track.title}
                                                    busy={rate.isPending && rate.variables?.id === track.id}
                                                    onChange={rating => {
                                                        rate.mutate({ id: track.id, rating });
                                                    }}
                                                />
                                            </Table.Td>
                                        </Table.Tr>
                                        {/* One wider than the row above it, so the expansion still spans
                                        the table now that the rating has its own column. */}
                                        <TrackEnrichmentRow trackId={track.id} open={expansion.isOpen(track.id)} colSpan={8} />
                                    </Fragment>
                                ))}
                            </Table.Tbody>
                        </Table>
                    </Table.ScrollContainer>
                    <CatalogPagination
                        total={tracks.data.meta.total}
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
