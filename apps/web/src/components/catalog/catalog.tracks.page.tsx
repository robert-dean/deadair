import { Fragment } from 'react';
import { Anchor, Group, Stack, Table, Text, Tooltip } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';

import { catalogTracksOptions, useRateTrack } from '../../api/catalog.queries';
import { formatDuration } from '../shared/format.duration';
import { Artwork } from '../shared/artwork';
import { AlbumLink, ArtistLink, TrackLink } from '../shared/catalog.links';
import { EmptyState } from '../shared/empty.state';
import { ErrorAlert } from '../shared/error.alert';
import { PageHeader } from '../shared/page.header';
import { PageSkeleton } from '../shared/page.skeleton';
import { SortableTh } from '../shared/sortable.th';
import { CatalogPagination } from './catalog.pagination';
import type { TrackSort } from '@deadair/sdk';
import { CATALOG_SEARCH_DEFAULTS, type TrackListOrder, type TrackStateParam } from './catalog.page.params';
import { CatalogSearch } from './catalog.search';
import { RatingControl } from './rating.control';
import { TrackStateAction } from './track.state.action';
import { TrackStateFilter } from './track.state.filter';
import { TrackEnrichmentRow, TrackExpandButton, useTrackExpansion } from './track.expansion';

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

/** How each state reads when nothing is in it, in the operator's terms rather than the column's. */
const NOTHING_IN_STATE: Record<TrackStateParam, string> = {
    cached: 'Nothing is on this machine yet. The station fetches a record a few boundaries before its slot.',
    uncached: 'Every record is already on this machine.',
    unmeasured: 'Every record has been measured, so the station has cue points and a level for all of them.',
    failing: 'No fetch is failing.',
    benched: 'No record has had all its copies written off.',
};

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
    if (search !== '') {
        return <EmptyState title={`Nothing matches “${search}”`}>Try a shorter term, or part of the title rather than all of it.</EmptyState>;
    }

    if (total === 0) {
        return <EmptyState title="The catalog is empty">The catalog fills as enabled plugins are scanned. Nothing has been ingested yet.</EmptyState>;
    }

    if (state !== '') return <EmptyState title="Nothing is in this state">{NOTHING_IN_STATE[state]}</EmptyState>;

    // Unreachable in practice: an unfiltered list of a non-empty catalog has rows. Answered rather
    // than left blank, because a page drawing nothing at all reads as broken.
    return <EmptyState title="Nothing to show">This page of the catalog has no records on it.</EmptyState>;
}

/**
 * One of the three state marks on a row.
 *
 * A letter rather than a word, and dimmed rather than absent when it is false: a column of present
 * and missing words would be unreadable at fifty rows, and a mark that vanished would make an
 * unmeasured record look like a rendering bug. The tooltip carries the sentence.
 */
function StateMark({ on, label, mark }: { on: boolean; label: string; mark: string }) {
    return (
        <Tooltip label={on ? `Has ${label}` : `No ${label}`}>
            <Text component="span" size="xs" ff="monospace" fw={600} c={on ? 'teal' : 'dimmed'} opacity={on ? 1 : 0.35} aria-label={label}>
                {mark}
            </Text>
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
    const tracks = useQuery(catalogTracksOptions({ page, search, state, ...order }));
    const rows = tracks.data?.data ?? [];
    const expansion = useTrackExpansion();
    const rate = useRateTrack();

    // Spread into every heading, so a column cannot be drawn active while sorting by another.
    const sorting = {
        active: order.sortBy,
        direction: order.sort,
        onSort: (sortBy: TrackSort, sort: 'asc' | 'desc') => onOrderChange({ ...order, sortBy, sort }),
    };

    return (
        <Stack gap="lg">
            <Stack gap="xxs">
                {/* `renderRoot` rather than `component={Link}`: the polymorphic form erases the
                    router's own types, and with them the check that `params` matches the path. */}
                <Anchor renderRoot={(props: object) => <Link to="/catalog" search={CATALOG_SEARCH_DEFAULTS} {...props} />} size="sm">
                    Back to catalog
                </Anchor>
                <PageHeader
                    title="Tracks"
                    description={
                        <Text c="dimmed" size="sm">
                            Every track the station has ingested.
                        </Text>
                    }
                />
            </Stack>

            <CatalogSearch value={search} placeholder="Search tracks" onChange={onSearchChange} />

            {/* Under the search rather than over it: the counts describe whatever the search has
                narrowed to, and reading them above the box they answer to would be backwards. */}
            <TrackStateFilter counts={tracks.data?.states} value={state} onChange={onStateChange} />

            {/* Under the filter and above the table, because it acts on what the filter chose and on
                the rows drawn below it. Draws nothing outside the two fault states: most of a
                library is `uncached`, and a bulk verb over that is a re-fetch of everything. */}
            <TrackStateAction state={state} trackIds={rows.map(track => track.id)} />

            {tracks.error ? (
                <ErrorAlert title="The tracks could not be loaded" error={tracks.error} fallback="The catalog is unavailable." />
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

            {tracks.data && rows.length > 0 ? (
                <>
                    <Table.ScrollContainer minWidth={800}>
                        <Table highlightOnHover>
                            <Table.Thead>
                                <Table.Tr>
                                    <Table.Th w={52} />
                                    <Table.Th w={44} />
                                    <SortableTh sortBy="title" {...sorting}>
                                        Title
                                    </SortableTh>
                                    <SortableTh sortBy="artist" {...sorting}>
                                        Artist
                                    </SortableTh>
                                    <SortableTh sortBy="album" {...sorting}>
                                        Album
                                    </SortableTh>
                                    <SortableTh sortBy="duration" w={120} {...sorting}>
                                        Duration
                                    </SortableTh>
                                    {/* Not sortable, and the contract says why: a state is three
                                    independent booleans, so there is no order of it an operator
                                    would agree with. */}
                                    <Table.Th w={110}>State</Table.Th>
                                    <SortableTh sortBy="rating" w={150} {...sorting}>
                                        Rating
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
                                            {/* Three facts, as three marks rather than three columns: what
                                            a row can afford is a glance, and anything more detailed is
                                            the record's own page one click away. */}
                                            <Table.Td>
                                                <Group gap="xxs" wrap="nowrap">
                                                    <StateMark on={track.hasAudio} label="audio on this machine" mark="A" />
                                                    <StateMark on={track.measured} label="measured" mark="M" />
                                                    <StateMark on={track.enriched} label="described by a provider" mark="E" />
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
